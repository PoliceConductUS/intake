import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { transform } from "../../../sources/youtube.audittheaudit/transform.js";
import { readXlsx } from "../../../src/cli/transform/read-xlsx.js";

const CHANNEL_ID = "UCc-0YpRpqgA5lPTpSQ5uo-Q";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

function video(fields: {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
}) {
  return {
    ...fields,
    channelId: CHANNEL_ID,
    url: `https://www.youtube.com/watch?v=${fields.videoId}`,
  };
}

const envelope = {
  agency: { id: "a1", name: "Irving Police Department", state: "TX" },
  channel: { id: CHANNEL_ID, handle: "@AuditTheAudit" },
  window: {
    startsAt: "2021-10-24T12:00:00.000Z",
    endsAt: "2026-10-24T12:00:00.000Z",
  },
  retrievedAt: "2026-10-24T12:00:00.000Z",
  videos: [
    video({
      videoId: "v1",
      title: "Officer John Smith reviewed at a traffic stop",
      description: "Sergeant Jane Wilson arrives later in the encounter.",
      publishedAt: "2024-03-05T12:00:00Z",
    }),
    video({
      // Names an officer who does not resolve at this agency -> no link, and the
      // video stays acquired so a later run reconsiders it.
      videoId: "v2",
      title: "Traffic stop reviewed",
      description: "Officer Nobody Stranger writes a ticket.",
      publishedAt: "2025-01-01T00:00:00Z",
    }),
    video({
      // Names no officer -> no link.
      videoId: "v3",
      title: "Audit the Audit reviews a county encounter",
      description: "General footage, no one named.",
      publishedAt: "2025-02-02T00:00:00Z",
    }),
    video({
      // Published before the window started -> no link, even though it names a
      // resolvable officer.
      videoId: "v4",
      title: "Officer John Smith reviewed",
      description: "An older encounter.",
      publishedAt: "2019-06-01T00:00:00Z",
    }),
    video({
      // Ambiguous: the resolver returns no definite match.
      videoId: "v5",
      title: "Deputy Ambiguous Twin reviewed",
      description: "Two officers share this name at the agency.",
      publishedAt: "2026-01-05T00:00:00Z",
    }),
  ],
};

// Fake resolver: only the named officers exist at agency a1. "Ambiguous Twin"
// stands in for the resolver's ambiguity band, which returns null.
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
  data: ReturnType<typeof fakeData> = fakeData(),
  envelopeOverride: unknown = envelope,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "youtube-ata-"));
  tempDirs.push(dir);
  const file = path.join(dir, "irving-police-department.a1.videos.json");
  await writeFile(file, JSON.stringify(envelopeOverride));
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

describe("youtube.audittheaudit transform", () => {
  it("links an in-window video to every officer it names that resolves at the acquired agency", async () => {
    const { byKind } = await runWith();

    expect(Object.keys(byKind.CoverageLinks)).toEqual(["v1"]);
    expect(byKind.CoverageLinks.v1.spec).toEqual({
      url: "https://www.youtube.com/watch?v=v1",
      normalized_url: "https://www.youtube.com/watch?v=v1",
      title: "Officer John Smith reviewed at a traffic stop",
      source_name: "Audit the Audit",
      published_at: "2024-03-05",
      notes: "Sergeant Jane Wilson arrives later in the encounter.",
    });

    // One link per resolved officer, each citing the naming passage.
    expect(byKind.CoverageLinkAgencyPersonnel).toEqual({
      "v1|ao-1": {
        spec: {
          coverage_link_id: "v1",
          agency_personnel_id: "ao-1",
          confidence: "named-in-video",
          notes: "Officer John Smith",
        },
      },
      "v1|ao-2": {
        spec: {
          coverage_link_id: "v1",
          agency_personnel_id: "ao-2",
          confidence: "named-in-video",
          notes: "Sergeant Jane Wilson",
        },
      },
    });
  });

  it("emits nothing for an unmatched, unnamed, or ambiguous video", async () => {
    const { byKind } = await runWith();
    for (const videoId of ["v2", "v3", "v5"]) {
      expect(Object.keys(byKind.CoverageLinks)).not.toContain(videoId);
      expect(
        Object.keys(byKind.CoverageLinkAgencyPersonnel).filter((key) =>
          key.startsWith(`${videoId}|`),
        ),
      ).toEqual([]);
    }
  });

  it("emits nothing for a video published before the window, even when its officer resolves", async () => {
    const { byKind } = await runWith();
    expect(Object.keys(byKind.CoverageLinks)).not.toContain("v4");
    // The out-of-window video is never resolved against the roster at all.
    expect(
      (await runWith()).byKind.CoverageLinkAgencyPersonnel["v4|ao-1"],
    ).toBeUndefined();
  });

  it("emits nothing for a video published after the window ends", async () => {
    const { byKind } = await runWith(fakeData(), {
      ...envelope,
      videos: [
        video({
          videoId: "future",
          title: "Officer John Smith reviewed",
          description: "",
          publishedAt: "2026-10-24T12:00:01Z",
        }),
      ],
    });
    expect(byKind.CoverageLinks).toEqual({});
  });

  it("picks up a previously skipped video once the officer exists", async () => {
    const before = await runWith();
    expect(Object.keys(before.byKind.CoverageLinks)).not.toContain("v2");

    // Same acquired evidence, later database state: the officer now exists.
    const after = await runWith(
      fakeData({
        "John Smith": "ao-1",
        "Jane Wilson": "ao-2",
        "Nobody Stranger": "ao-3",
      }),
    );
    expect(Object.keys(after.byKind.CoverageLinks).sort()).toEqual([
      "v1",
      "v2",
    ]);
    expect(
      after.byKind.CoverageLinkAgencyPersonnel["v2|ao-3"].spec,
    ).toMatchObject({
      coverage_link_id: "v2",
      agency_personnel_id: "ao-3",
      notes: "Officer Nobody Stranger",
    });
  });

  it("produces the same records when source and database state are unchanged", async () => {
    const first = (await runWith()).manifest;
    const second = (await runWith()).manifest;
    expect(second).toEqual(first);
    // One record per video id, so a re-run upserts rather than duplicating.
    expect(Object.keys(first.artifacts[0].records)).toEqual(["v1"]);
  });

  it("resolves every mention scoped to the acquired agency and mints nothing", async () => {
    const data = fakeData();
    await runWith(data);
    expect(data.calls.every((call) => call.agencyId === "a1")).toBe(true);
    expect(data.calls.map((call) => call.personnelName)).toContain(
      "John Smith",
    );
  });

  it("emits only the two coverage kinds it declares", async () => {
    const { byKind } = await runWith();
    expect(Object.keys(byKind).sort()).toEqual([
      "CoverageLinkAgencyPersonnel",
      "CoverageLinks",
    ]);
  });

  it("fails loudly when the evidence records no window", async () => {
    const { window: _window, ...noWindow } = envelope;
    await expect(runWith(fakeData(), noWindow)).rejects.toThrow(
      /records no acquisition window/,
    );
  });

  it("fails loudly when the evidence came from another channel", async () => {
    await expect(
      runWith(fakeData(), {
        ...envelope,
        channel: { id: "UCsomeoneelse", handle: "@SomeoneElse" },
      }),
    ).rejects.toThrow(/not UCc-0YpRpqgA5lPTpSQ5uo-Q/);
  });

  it("fails loudly when a stored video came from another channel", async () => {
    await expect(
      runWith(fakeData(), {
        ...envelope,
        videos: [
          {
            ...video({
              videoId: "vx",
              title: "Officer John Smith reviewed",
              description: "",
              publishedAt: "2024-03-05T12:00:00Z",
            }),
            channelId: "UCsomeoneelse",
          },
        ],
      }),
    ).rejects.toThrow(/holds video vx from channel UCsomeoneelse/);
  });

  it("requires a data context to resolve officers", async () => {
    await expect(
      transform({
        paths: [],
        readXlsx,
        state: ".",
        emit: async () => {},
      }),
    ).rejects.toThrow(/requires a data context/);
  });
});
