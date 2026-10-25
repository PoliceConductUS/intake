import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { transform } from "../../../sources/youtube.donutoperator/transform.js";
import { CHANNEL_ID } from "../../../sources/youtube.donutoperator/channel.js";
import { readXlsx } from "../../../src/cli/transform/read-xlsx.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

// Every run below is pinned to this instant, so the rolling five-year window is
// exactly [2021-06-01, 2026-06-01] and the fixtures below sit either side of it
// on purpose.
const NOW = "2026-06-01T00:00:00Z";
const PINNED_ENV = { YOUTUBE_WINDOW_NOW: NOW };

function video(over: Record<string, unknown>) {
  return {
    description: "",
    captions: null,
    channelId: CHANNEL_ID,
    retrievedAt: "2026-06-01T00:00:00Z",
    ...over,
  };
}

const envelope = {
  agency: { id: "a1", name: "Irving Police Department", state: "TX" },
  channelId: CHANNEL_ID,
  videos: [
    video({
      // In window, names a resolvable officer -> the one link.
      videoId: "v1",
      url: "https://www.youtube.com/watch?v=v1",
      title: "Bodycam: Irving PD arrest",
      description: "Officer John Smith responds to a call.",
      captions: "Sergeant Jane Wilson also arrived on scene.",
      publishedAt: "2024-03-05T12:00:00Z",
    }),
    video({
      // Names the SAME resolvable officer, but published before the window
      // opened -> no link. The window gate is independent of the officer gate.
      videoId: "v2-old",
      url: "https://www.youtube.com/watch?v=v2-old",
      title: "Archive: Irving PD 2019",
      description: "Officer John Smith on an old call.",
      publishedAt: "2019-01-01T00:00:00Z",
    }),
    video({
      // In window, names an officer who does not resolve at this agency -> no
      // link this run, reconsidered next run.
      videoId: "v3-unresolved",
      url: "https://www.youtube.com/watch?v=v3-unresolved",
      title: "Traffic stop",
      description: "Officer Nobody Stranger writes a ticket.",
      publishedAt: "2025-01-01T00:00:00Z",
    }),
    video({
      // In window, names no officer at all -> no link.
      videoId: "v4-unnamed",
      url: "https://www.youtube.com/watch?v=v4-unnamed",
      title: "Dashcam highlights",
      description: "General footage, no one named.",
      publishedAt: "2025-02-02T00:00:00Z",
    }),
    video({
      // In window and names a resolvable officer, but is not from the pinned
      // channel -> no link.
      videoId: "v5-other-channel",
      url: "https://www.youtube.com/watch?v=v5-other-channel",
      title: "Reupload",
      description: "Officer John Smith responds to a call.",
      publishedAt: "2026-05-01T00:00:00Z",
      channelId: "UCsomeoneelse",
    }),
    video({
      // Dated in the future (a scheduled premiere) -> not inside a window that
      // ends at the run.
      videoId: "v6-future",
      url: "https://www.youtube.com/watch?v=v6-future",
      title: "Premiere",
      description: "Officer John Smith responds to a call.",
      publishedAt: "2026-09-01T00:00:00Z",
    }),
  ],
};

// Fake run-phase resolver. The real one is intake-owned and applies a confidence
// floor and an ambiguity band (ADR 0022/0023); both "no match" and "ambiguous"
// surface to a source as null, which is the only answer this source acts on.
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
  env: Record<string, string | undefined> = PINNED_ENV,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "youtube-donut-"));
  tempDirs.push(dir);
  const file = path.join(dir, "irving-police-department.videos.json");
  await writeFile(file, JSON.stringify(envelope));
  const manifest = await transform({
    paths: [file],
    readXlsx,
    state: dir,
    emit: async () => {},
    env,
    data,
  });
  const byKind = Object.fromEntries(
    manifest.artifacts.map((a) => [a.kind, a.records]),
  );
  return { manifest, byKind };
}

describe("youtube.donutoperator transform", () => {
  it("links an in-window video to every officer it names that resolves at the acquired agency", async () => {
    const { byKind } = await runWith();

    expect(Object.keys(byKind.CoverageLinks)).toEqual(["v1"]);
    expect(byKind.CoverageLinks.v1.spec).toEqual({
      url: "https://www.youtube.com/watch?v=v1",
      normalized_url: "https://www.youtube.com/watch?v=v1",
      title: "Bodycam: Irving PD arrest",
      source_name: "Donut Operator",
      published_at: "2024-03-05",
      notes: "Officer John Smith responds to a call.",
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

  it("emits no link for a video published before the rolling window, even when it names a resolvable officer", async () => {
    const { byKind } = await runWith();
    expect(Object.keys(byKind.CoverageLinks)).not.toContain("v2-old");
    expect(Object.keys(byKind.CoverageLinkAgencyPersonnel)).not.toContain(
      "v2-old|ao-1",
    );
  });

  it("emits no link for a video dated after the run", async () => {
    const { byKind } = await runWith();
    expect(Object.keys(byKind.CoverageLinks)).not.toContain("v6-future");
  });

  it("emits no link for an unresolvable, ambiguous, or unnamed officer mention", async () => {
    const { byKind } = await runWith();
    expect(Object.keys(byKind.CoverageLinks)).not.toContain("v3-unresolved");
    expect(Object.keys(byKind.CoverageLinks)).not.toContain("v4-unnamed");
  });

  it("emits no link for a video that is not from the pinned channel", async () => {
    const { byKind } = await runWith();
    expect(Object.keys(byKind.CoverageLinks)).not.toContain("v5-other-channel");
  });

  it("never asks about an out-of-window video, so no officer is even considered for one", async () => {
    const data = fakeData();
    await runWith(data);
    // v2-old and v6-future both name John Smith; the window gate runs first, so
    // the only reason John Smith is asked about at all is v1.
    expect(
      data.calls.filter((c) => c.personnelName === "John Smith"),
    ).toHaveLength(1);
  });

  it("resolves every mention scoped to the acquired agency and mints nothing", async () => {
    const data = fakeData();
    await runWith(data);
    expect(data.calls.every((c) => c.agencyId === "a1")).toBe(true);
    expect(data.calls.map((c) => c.personnelName)).toContain("Nobody Stranger");
  });

  it("picks up a previously skipped in-window video once the officer exists", async () => {
    const before = await runWith();
    expect(Object.keys(before.byKind.CoverageLinks)).not.toContain(
      "v3-unresolved",
    );

    // Same acquired archive, same window — only the database has changed.
    const after = await runWith(
      fakeData({ "John Smith": "ao-1", "Nobody Stranger": "ao-9" }),
    );
    expect(Object.keys(after.byKind.CoverageLinks).sort()).toEqual([
      "v1",
      "v3-unresolved",
    ]);
    expect(
      after.byKind.CoverageLinkAgencyPersonnel["v3-unresolved|ao-9"],
    ).toEqual({
      spec: {
        coverage_link_id: "v3-unresolved",
        agency_personnel_id: "ao-9",
        confidence: "named-in-video",
        notes: "Officer Nobody Stranger",
      },
    });
  });

  it("re-running unchanged source and database state produces the identical records", async () => {
    const first = (await runWith()).manifest;
    const second = (await runWith()).manifest;
    expect(second).toEqual(first);
    // Keys are the stable YouTube video id (and officer id), so a re-import
    // upserts the same rows rather than adding duplicates.
    expect(Object.keys(first.artifacts[0].records)).toEqual(["v1"]);
  });

  it("emits only the two coverage kinds it declares", async () => {
    const { byKind } = await runWith();
    expect(Object.keys(byKind).sort()).toEqual([
      "CoverageLinkAgencyPersonnel",
      "CoverageLinks",
    ]);
  });

  it("refuses to run without a data context rather than emitting unresolved links", async () => {
    await expect(
      transform({
        paths: [],
        readXlsx,
        state: tmpdir(),
        emit: async () => {},
        env: PINNED_ENV,
      }),
    ).rejects.toThrow(/data context/);
  });

  it("fails loudly on an unparseable window pin instead of silently using the wall clock", async () => {
    await expect(
      runWith(fakeData(), { YOUTUBE_WINDOW_NOW: "not-a-date" }),
    ).rejects.toThrow(/not a parseable instant/);
  });
});
