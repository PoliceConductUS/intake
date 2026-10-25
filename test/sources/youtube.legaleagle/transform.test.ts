import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import {
  produces,
  transform,
} from "../../../sources/youtube.legaleagle/transform.js";
import { config } from "../../../sources/youtube.legaleagle/config.js";
import { rollingWindow } from "../../../sources/lib/youtube-channel-cache.js";
import { readXlsx } from "../../../src/cli/transform/read-xlsx.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

const RUN_AT = new Date("2026-10-24T12:00:00.000Z");
const WINDOW = rollingWindow(RUN_AT, config.windowYears);

function video(fields: {
  videoId: string;
  publishedAt: string;
  description?: string;
  title?: string;
  channelId?: string;
}) {
  return {
    videoId: fields.videoId,
    url: `https://www.youtube.com/watch?v=${fields.videoId}`,
    title: fields.title ?? `LegalEagle reviews ${fields.videoId}`,
    description: fields.description ?? "",
    publishedAt: fields.publishedAt,
    channelId: fields.channelId ?? config.channelId,
    retrievedAt: RUN_AT.toISOString(),
  };
}

const envelope = {
  agency: { id: "a1", name: "Irving Police Department", state: "TX" },
  channelId: config.channelId,
  handle: "@LegalEagle",
  window: WINDOW,
  retrievedAt: RUN_AT.toISOString(),
  videos: [
    // In window, names two officers who both resolve at this agency.
    video({
      videoId: "v1",
      publishedAt: "2024-03-05T12:00:00Z",
      title: "Real lawyer reacts: Irving PD arrest",
      description:
        "Officer John Smith responds to a call. Sergeant Jane Wilson also arrived on scene.",
    }),
    // In window, names an officer who does not exist at this agency.
    video({
      videoId: "v2",
      publishedAt: "2024-01-01T00:00:00Z",
      description: "Officer Nobody Stranger writes a ticket.",
    }),
    // In window, names nobody.
    video({
      videoId: "v3",
      publishedAt: "2024-02-02T00:00:00Z",
      description: "General commentary, no one named.",
    }),
    // In window, but the name is ambiguous on the roster.
    video({
      videoId: "v4",
      publishedAt: "2024-04-04T00:00:00Z",
      description: "Deputy Chris Taylor makes the stop.",
    }),
    // Published before the window start — a resolvable officer must not save it.
    video({
      videoId: "v5",
      publishedAt: "2019-05-05T00:00:00Z",
      description: "Officer John Smith responds to a call.",
    }),
    // Published after the window end.
    video({
      videoId: "v6",
      publishedAt: "2026-12-01T00:00:00Z",
      description: "Officer John Smith responds to a call.",
    }),
  ],
};

// Fake resolver standing in for the intake-owned agency_personnel resolver:
// John Smith and Jane Wilson exist at a1; Chris Taylor is ambiguous, which the
// real resolver reports the same way it reports absent — as null (ADR 0022/0023).
function fakeData(
  resolved: Record<string, string> = {
    "John Smith": "ap-1",
    "Jane Wilson": "ap-2",
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
  body: unknown = envelope,
): Promise<{
  manifest: Awaited<ReturnType<typeof transform>>;
  byKind: Record<string, Record<string, { spec: unknown }>>;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "youtube-le-"));
  tempDirs.push(dir);
  const file = path.join(dir, "a1.videos.json");
  await writeFile(file, JSON.stringify(body));
  const manifest = await transform({
    paths: [file],
    readXlsx,
    state: dir,
    emit: async () => {},
    data,
  });
  return {
    manifest,
    byKind: Object.fromEntries(
      manifest.artifacts.map((a) => [a.kind, a.records]),
    ),
  };
}

describe("youtube.legaleagle configuration", () => {
  it("is the rank-6 channel with a five-year rolling window", () => {
    expect(config).toEqual({
      namespace: "youtube.legaleagle",
      channelId: "UCpa-Zb0ZcQjTCPP1Dx_1M8Q",
      handle: "@LegalEagle",
      sourceName: "LegalEagle",
      windowYears: 5,
    });
  });

  it("declares only the coverage kinds it emits", () => {
    expect([...produces].sort()).toEqual([
      "CoverageLinkAgencyPersonnel",
      "CoverageLinks",
    ]);
  });
});

describe("youtube.legaleagle transform", () => {
  it("links an in-window video to every officer it names that resolves at the acquired agency", async () => {
    const { byKind } = await runWith();

    expect(Object.keys(byKind.CoverageLinks)).toEqual(["v1"]);
    expect(byKind.CoverageLinks.v1.spec).toEqual({
      url: "https://www.youtube.com/watch?v=v1",
      normalized_url: "https://www.youtube.com/watch?v=v1",
      title: "Real lawyer reacts: Irving PD arrest",
      source_name: "LegalEagle",
      published_at: "2024-03-05",
      notes:
        "Officer John Smith responds to a call. Sergeant Jane Wilson also arrived on scene.",
    });

    expect(byKind.CoverageLinkAgencyPersonnel).toEqual({
      "v1|ap-1": {
        spec: {
          coverage_link_id: "v1",
          agency_personnel_id: "ap-1",
          confidence: "named-in-video",
          notes: "Officer John Smith",
        },
      },
      "v1|ap-2": {
        spec: {
          coverage_link_id: "v1",
          agency_personnel_id: "ap-2",
          confidence: "named-in-video",
          notes: "Sergeant Jane Wilson",
        },
      },
    });
  });

  it("emits nothing for an absent, ambiguous, or unnamed officer", async () => {
    const { byKind } = await runWith();
    const links = Object.keys(byKind.CoverageLinks);
    expect(links).not.toContain("v2"); // absent at this agency
    expect(links).not.toContain("v3"); // names nobody
    expect(links).not.toContain("v4"); // ambiguous on the roster
  });

  it("emits nothing for a video outside the rolling window even when the officer resolves", async () => {
    const { byKind } = await runWith();
    const links = Object.keys(byKind.CoverageLinks);
    expect(links).not.toContain("v5"); // before the window start
    expect(links).not.toContain("v6"); // after the window end
  });

  it("does not even attempt to resolve an officer for an out-of-window video", async () => {
    const data = fakeData();
    await runWith(data);
    // v5/v6 name John Smith; the window gate runs before the resolver, so the
    // only John Smith resolution comes from v1.
    expect(
      data.calls.filter((c) => c.personnelName === "John Smith"),
    ).toHaveLength(1);
  });

  it("scopes every resolution to the acquired agency and mints nothing", async () => {
    const data = fakeData();
    await runWith(data);
    expect(data.calls.every((c) => c.agencyId === "a1")).toBe(true);
    expect(data.calls.map((c) => c.personnelName)).toContain("John Smith");
  });

  it("picks up a previously skipped in-window video once the officer exists", async () => {
    // First run: the roster has nobody, so the video is skipped, not recorded as
    // a terminal decision.
    const before = await runWith(fakeData({}));
    expect(Object.keys(before.byKind.CoverageLinks)).toEqual([]);

    // A later run over the same acquired evidence, after the officer exists.
    const after = await runWith(fakeData({ "Nobody Stranger": "ap-9" }));
    expect(Object.keys(after.byKind.CoverageLinks)).toEqual(["v2"]);
    expect(after.byKind.CoverageLinkAgencyPersonnel["v2|ap-9"].spec).toEqual({
      coverage_link_id: "v2",
      agency_personnel_id: "ap-9",
      confidence: "named-in-video",
      notes: "Officer Nobody Stranger",
    });
  });

  it("does not duplicate links when source and database state are unchanged", async () => {
    const first = (await runWith()).manifest;
    const second = (await runWith()).manifest;
    expect(second).toEqual(first);
    for (const artifact of second.artifacts) {
      expect(Object.keys(artifact.records)).toEqual([
        ...new Set(Object.keys(artifact.records)),
      ]);
    }
  });

  it("applies the window recorded on the envelope, not the current clock", async () => {
    // Under the run's window (2021-10..2026-10), v1 qualifies and v5 is too old.
    expect(Object.keys((await runWith()).byKind.CoverageLinks)).toEqual(["v1"]);

    // The identical videos under an envelope acquired against an earlier window
    // (2018-01..2023-01) flip: v5 is now in window and v1 has not happened yet.
    // Only the envelope changed, so the window is what decided.
    const { byKind } = await runWith(fakeData(), {
      ...envelope,
      window: rollingWindow(new Date("2023-01-01T00:00:00.000Z"), 5),
    });
    expect(Object.keys(byKind.CoverageLinks)).toEqual(["v5"]);
  });

  it("fails loudly on an envelope with no usable window rather than emitting unbounded links", async () => {
    await expect(
      runWith(fakeData(), { ...envelope, window: undefined }),
    ).rejects.toThrow(/no usable publication window/);
  });

  it("emits nothing for a video that is not from the pinned channel", async () => {
    // Re-verified on the evidence, so the guarantee holds on a replay where
    // acquire never ran.
    const { byKind } = await runWith(fakeData(), {
      ...envelope,
      videos: [
        video({
          videoId: "vx",
          publishedAt: "2024-03-05T12:00:00Z",
          description: "Officer John Smith responds to a call.",
          channelId: "UCsomeoneElsesChannel00",
        }),
      ],
    });
    expect(Object.keys(byKind.CoverageLinks)).toEqual([]);
  });

  it("derives officer candidates from title and description only", async () => {
    // Captions are off limits (youtube.com/robots.txt: `Disallow: /api/`), so an
    // acquired video carries no caption field and a name that would only have
    // appeared in a transcript cannot produce a link.
    const data = fakeData({ "John Smith": "ap-1", "Jane Wilson": "ap-2" });
    const { byKind } = await runWith(data, {
      ...envelope,
      videos: [
        video({
          videoId: "vt",
          publishedAt: "2024-03-05T12:00:00Z",
          title: "Real lawyer reacts",
          description: "Officer John Smith responds to a call.",
        }),
      ],
    });
    expect(Object.keys(byKind.CoverageLinkAgencyPersonnel)).toEqual([
      "vt|ap-1",
    ]);
    expect(data.calls.map((c) => c.personnelName)).not.toContain("Jane Wilson");
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
