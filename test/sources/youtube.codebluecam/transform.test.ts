import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { CODE_BLUE_CAM } from "../../../sources/youtube.codebluecam/channel.js";
import { transform } from "../../../sources/youtube.codebluecam/transform.js";
import type { TransformDeps } from "../../../src/cli/transform/source-transform.js";

// This source reads JSON envelopes, never a spreadsheet; a stub keeps the test
// off the xlsx reader (and its native dependency) entirely.
const readXlsx = (() => {
  throw new Error("youtube.codebluecam reads no spreadsheets");
}) as unknown as TransformDeps["readXlsx"];

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

// A run on 2026-10-24 → the rolling five-year window opens 2021-10-24.
const WINDOW = {
  startAt: "2021-10-24T00:00:00.000Z",
  endAt: "2026-10-24T00:00:00.000Z",
};
const RETRIEVED_AT = "2026-10-24T00:00:00.000Z";

function video(overrides: Partial<Record<string, unknown>>) {
  return {
    videoId: "v0",
    title: "Bodycam",
    description: "",
    publishedAt: "2024-03-05T12:34:56Z",
    channelId: CODE_BLUE_CAM.channelId,
    url: "https://www.youtube.com/watch?v=v0",
    retrievedAt: RETRIEVED_AT,
    captions: null,
    ...overrides,
  };
}

const videos = [
  // In window, names two officers who both exist at this agency.
  video({
    videoId: "inWindowMatch",
    title: "Bodycam: Irving PD arrest",
    description: "Officer John Smith responds to a call.",
    publishedAt: "2024-03-05T12:34:56Z",
    captions: "Sergeant Jane Wilson also arrived on scene.",
  }),
  // In window, but the named officer is not in the database yet -> skipped.
  video({
    videoId: "inWindowNoOfficer",
    title: "Traffic stop",
    description: "Officer Nobody Stranger writes a ticket.",
    publishedAt: "2025-01-02T00:00:00Z",
  }),
  // In window, names nobody -> skipped.
  video({
    videoId: "inWindowUnnamed",
    title: "Dashcam highlights",
    description: "General footage, no one named.",
    publishedAt: "2025-02-02T00:00:00Z",
  }),
  // Published before the window opened, names an officer who DOES exist.
  video({
    videoId: "beforeWindow",
    title: "Older incident",
    description: "Officer John Smith responds to a call.",
    publishedAt: "2021-10-23T23:59:59Z",
  }),
];

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    agency: { id: "a1", name: "Irving Police Department", state: "TX" },
    channel: {
      handle: CODE_BLUE_CAM.channelHandle,
      channelId: CODE_BLUE_CAM.channelId,
    },
    window: WINDOW,
    videos,
    ...overrides,
  };
}

// Fake transform-phase resolver: only these names exist at agency a1. An
// ambiguous mention resolves to null, exactly as the real resolver's ambiguity
// band does.
function fakeData(
  resolved: Record<string, string> = {
    "John Smith": "ao-1",
    "Jane Wilson": "ao-2",
  },
) {
  const calls: Array<{ agencyId: string; personnelName: string }> = [];
  return {
    calls,
    resolvePersonnel: async ({
      agencyId,
      personnelName,
    }: {
      agencyId: string;
      personnelName: string;
    }) => {
      calls.push({ agencyId, personnelName });
      const id = resolved[personnelName];
      return id === undefined ? null : { agencyPersonnelId: id };
    },
  };
}

async function runWith(
  data = fakeData(),
  envelopeOverrides: Record<string, unknown> = {},
) {
  const dir = await mkdtemp(path.join(tmpdir(), "youtube-cbc-"));
  tempDirs.push(dir);
  const file = path.join(dir, "irving-police-department.videos.json");
  await writeFile(file, JSON.stringify(envelope(envelopeOverrides)));
  const manifest = await transform({
    paths: [file],
    readXlsx,
    state: dir,
    emit: async () => {},
    data,
  });
  const byKind = Object.fromEntries(
    manifest.artifacts.map((a) => [a.kind, a.records]),
  );
  return { manifest, byKind };
}

describe("youtube.codebluecam transform", () => {
  it("links an in-window video to every officer it names that resolves at the acquired agency", async () => {
    const { byKind } = await runWith();

    expect(Object.keys(byKind.CoverageLinks)).toEqual(["inWindowMatch"]);
    const spec = byKind.CoverageLinks.inWindowMatch.spec as Record<
      string,
      unknown
    >;
    expect(spec.url).toBe("https://www.youtube.com/watch?v=inWindowMatch");
    expect(spec.title).toBe("Bodycam: Irving PD arrest");
    expect(spec.source_name).toBe("Code Blue Cam");
    expect(spec.published_at).toBe("2024-03-05");

    // One link per resolved officer, each citing the naming passage.
    expect(byKind.CoverageLinkAgencyPersonnel).toEqual({
      "inWindowMatch|ao-1": {
        spec: {
          coverage_link_id: "inWindowMatch",
          agency_personnel_id: "ao-1",
          confidence: "named-in-video",
          notes: "Officer John Smith",
        },
      },
      "inWindowMatch|ao-2": {
        spec: {
          coverage_link_id: "inWindowMatch",
          agency_personnel_id: "ao-2",
          confidence: "named-in-video",
          notes: "Sergeant Jane Wilson",
        },
      },
    });
  });

  it("preserves the channel id, full publication time, retrieval time and canonical URL as link provenance", async () => {
    const { byKind } = await runWith();
    const notes = (byKind.CoverageLinks.inWindowMatch.spec as { notes: string })
      .notes;

    expect(notes).toContain(
      "Code Blue Cam (YouTube channel UCCKkuXux09y-TCg-BQxCjNA)",
    );
    expect(notes).toContain("video inWindowMatch");
    // The date column truncates; the timestamp survives here.
    expect(notes).toContain("published 2024-03-05T12:34:56Z");
    expect(notes).toContain(`retrieved ${RETRIEVED_AT}`);
    expect(notes).toContain("https://www.youtube.com/watch?v=inWindowMatch");
    // The publisher's framing stays an attributed claim, above the provenance.
    expect(notes.startsWith("Officer John Smith responds to a call.")).toBe(
      true,
    );
  });

  it("emits no link for a video published before the rolling window opened", async () => {
    const { byKind } = await runWith();
    expect(Object.keys(byKind.CoverageLinks)).not.toContain("beforeWindow");
    expect(
      Object.keys(byKind.CoverageLinkAgencyPersonnel).some((k) =>
        k.startsWith("beforeWindow"),
      ),
    ).toBe(false);
  });

  it("emits no link for a video published after the window closes", async () => {
    const { byKind } = await runWith(fakeData(), {
      videos: [
        video({
          videoId: "afterWindow",
          description: "Officer John Smith responds to a call.",
          publishedAt: "2026-10-25T00:00:00Z",
        }),
      ],
    });
    expect(byKind.CoverageLinks).toEqual({});
  });

  it("emits no link for an unmatched or unnamed in-window video", async () => {
    const { byKind } = await runWith();
    expect(Object.keys(byKind.CoverageLinks)).not.toContain(
      "inWindowNoOfficer",
    );
    expect(Object.keys(byKind.CoverageLinks)).not.toContain("inWindowUnnamed");
  });

  it("emits no link when a mention is ambiguous", async () => {
    // The resolver returns null for an over-the-ambiguity-band match.
    const { byKind } = await runWith(fakeData({}));
    expect(byKind.CoverageLinks).toEqual({});
    expect(byKind.CoverageLinkAgencyPersonnel).toEqual({});
  });

  it("picks up a previously skipped, still-in-window video once its officer exists", async () => {
    // Run 1: nobody at the agency matches the mention -> no link, nothing stored
    // about the skip.
    const first = await runWith(fakeData({}));
    expect(first.byKind.CoverageLinks).toEqual({});

    // Run 2: same unchanged envelope, but the officer is now in the database.
    const second = await runWith(fakeData({ "Nobody Stranger": "ao-9" }));
    expect(Object.keys(second.byKind.CoverageLinks)).toEqual([
      "inWindowNoOfficer",
    ]);
    expect(second.byKind.CoverageLinkAgencyPersonnel).toEqual({
      "inWindowNoOfficer|ao-9": {
        spec: {
          coverage_link_id: "inWindowNoOfficer",
          agency_personnel_id: "ao-9",
          confidence: "named-in-video",
          notes: "Officer Nobody Stranger",
        },
      },
    });
  });

  it("does not duplicate links when source and database state are unchanged", async () => {
    const first = (await runWith()).manifest;
    const second = (await runWith()).manifest;
    expect(second).toEqual(first);
    // Records are keyed by the stable video id, so a merge is a replace.
    expect(Object.keys(first.artifacts[0].records)).toEqual(["inWindowMatch"]);
  });

  it("resolves every mention scoped to the acquired agency and mints nothing", async () => {
    const data = fakeData();
    await runWith(data);
    expect(data.calls.every((c) => c.agencyId === "a1")).toBe(true);
    expect(data.calls.map((c) => c.personnelName)).toContain("John Smith");
    // Only the two coverage-link kinds; no Agency or Personnel is produced.
    const { manifest } = await runWith();
    expect(manifest.artifacts.map((a) => a.kind).sort()).toEqual([
      "CoverageLinkAgencyPersonnel",
      "CoverageLinks",
    ]);
  });

  it("refuses an envelope acquired from a different channel", async () => {
    await expect(
      runWith(fakeData(), {
        channel: { handle: "@CodeBlueCam", channelId: "UCsomeOtherChannel" },
      }),
    ).rejects.toThrow(/not the pinned UCCKkuXux09y-TCg-BQxCjNA/);
  });

  it("refuses an envelope with no recorded acquire window", async () => {
    await expect(runWith(fakeData(), { window: undefined })).rejects.toThrow(
      /no acquire window/,
    );
  });

  it("requires a data context to resolve officers", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "youtube-cbc-"));
    tempDirs.push(dir);
    await expect(
      transform({ paths: [dir], readXlsx, state: dir, emit: async () => {} }),
    ).rejects.toThrow(/requires a data context/);
  });
});
