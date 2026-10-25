import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { CHANNEL_ID } from "../../../sources/youtube.lawandcrime/channel.js";
import { transform } from "../../../sources/youtube.lawandcrime/transform.js";
import { readXlsx } from "../../../src/cli/transform/read-xlsx.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

function video(fields: {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId?: string;
}) {
  return {
    channelId: CHANNEL_ID,
    url: `https://www.youtube.com/watch?v=${fields.videoId}`,
    retrievedAt: "2026-10-24T18:30:00.000Z",
    ...fields,
  };
}

// Acquire writes only in-window videos, so the envelope is the whole universe
// the transform may link: v1 names two existing officers, v2 names an officer
// who does not exist at this agency, v3 names an ambiguous officer, v4 names
// nobody.
const envelope = {
  agency: { id: "a1", name: "Irving Police Department", state: "TX" },
  channel: {
    channelId: CHANNEL_ID,
    handle: "@lawandcrime",
    title: "Law&Crime Network",
  },
  window: { from: "2021-10-24T18:30:00.000Z", to: "2026-10-24T18:30:00.000Z" },
  retrievedAt: "2026-10-24T18:30:00.000Z",
  videos: [
    video({
      videoId: "v1",
      title: "Bodycam: Officer John Smith arrests suspect",
      description: "Sergeant Jane Wilson also arrived on scene.",
      publishedAt: "2024-03-05T12:00:00Z",
    }),
    video({
      videoId: "v2",
      title: "Traffic stop",
      description: "Officer Nobody Stranger writes a ticket.",
      publishedAt: "2024-01-01T00:00:00Z",
    }),
    video({
      videoId: "v3",
      title: "Courtroom coverage",
      description: "Deputy Chris Ambiguous testifies.",
      publishedAt: "2023-06-01T00:00:00Z",
    }),
    video({
      videoId: "v4",
      title: "Trial recap",
      description: "General coverage, no officer named.",
      publishedAt: "2025-02-02T00:00:00Z",
    }),
  ],
};

// Fake resolver: the intake-owned resolver returns null both for an officer that
// does not exist and for one it cannot separate between candidates, so an
// ambiguous name is indistinguishable here from an absent one — by design.
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
  source: Record<string, unknown> = envelope,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "youtube-lac-"));
  tempDirs.push(dir);
  const file = path.join(dir, "irving-police-department.videos.json");
  await writeFile(file, JSON.stringify(source));
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

describe("youtube.lawandcrime transform", () => {
  it("links an in-window video to every officer it names that resolves at the acquired agency", async () => {
    const { byKind } = await runWith();

    expect(Object.keys(byKind.CoverageLinks)).toEqual(["v1"]);
    expect(byKind.CoverageLinks.v1.spec).toEqual({
      url: "https://www.youtube.com/watch?v=v1",
      normalized_url: "https://www.youtube.com/watch?v=v1",
      title: "Bodycam: Officer John Smith arrests suspect",
      source_name: "Law&Crime Network",
      published_at: "2024-03-05",
      notes: "Sergeant Jane Wilson also arrived on scene.",
    });

    // One link per resolved officer, each citing the passage that names them.
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

  it("emits no link for an absent, ambiguous, or unnamed officer match", async () => {
    const { byKind } = await runWith();
    const links = Object.keys(byKind.CoverageLinks);
    expect(links).not.toContain("v2");
    expect(links).not.toContain("v3");
    expect(links).not.toContain("v4");
    expect(
      Object.keys(byKind.CoverageLinkAgencyPersonnel).filter((key) =>
        /^v[234]\|/.test(key),
      ),
    ).toEqual([]);
  });

  it("scopes every resolution to the acquired agency and mints nothing", async () => {
    const data = fakeData();
    await runWith(data);
    expect(data.calls.every((c) => c.agencyId === "a1")).toBe(true);
    expect(data.calls.map((c) => c.personnelName)).toEqual(
      expect.arrayContaining([
        "John Smith",
        "Jane Wilson",
        "Nobody Stranger",
        "Chris Ambiguous",
      ]),
    );
  });

  it("emits only the two coverage kinds it declares", async () => {
    const { byKind } = await runWith();
    expect(Object.keys(byKind).sort()).toEqual([
      "CoverageLinkAgencyPersonnel",
      "CoverageLinks",
    ]);
  });

  it("links a previously skipped video once the officer exists, with no re-fetch", async () => {
    // Run 1: Nobody Stranger is not in the database, so v2 is skipped.
    const first = await runWith();
    expect(Object.keys(first.byKind.CoverageLinks)).not.toContain("v2");

    // Run 2: the officer has since been imported at this agency. The same
    // envelope — no new acquire — now yields the link.
    const second = await runWith(
      fakeData({
        "John Smith": "ao-1",
        "Jane Wilson": "ao-2",
        "Nobody Stranger": "ao-9",
      }),
    );
    expect(Object.keys(second.byKind.CoverageLinks).sort()).toEqual([
      "v1",
      "v2",
    ]);
    expect(second.byKind.CoverageLinkAgencyPersonnel["v2|ao-9"].spec).toEqual({
      coverage_link_id: "v2",
      agency_personnel_id: "ao-9",
      confidence: "named-in-video",
      notes: "Officer Nobody Stranger",
    });
  });

  it("is deterministic and produces no duplicate keys on a re-run", async () => {
    const first = (await runWith()).manifest;
    const second = (await runWith()).manifest;
    expect(second).toEqual(first);
    // Keys are the stable video id (and video id + officer), so a re-run with
    // unchanged source and database state is the same manifest, not a second set.
    for (const artifact of second.artifacts) {
      const keys = Object.keys(artifact.records);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("refuses an envelope that declares another channel", async () => {
    await expect(
      runWith(fakeData(), {
        ...envelope,
        channel: { channelId: "UCsomeoneelse" },
      }),
    ).rejects.toThrow(/not the pinned UCz8K1occVvDTYDfFo7N5EZw/);
  });

  it("refuses a video that belongs to another channel", async () => {
    await expect(
      runWith(fakeData(), {
        ...envelope,
        videos: [
          video({
            videoId: "vx",
            title: "Officer John Smith on camera",
            description: "",
            publishedAt: "2024-03-05T12:00:00Z",
            channelId: "UCsomeoneelse",
          }),
        ],
      }),
    ).rejects.toThrow(/belongs to channel UCsomeoneelse/);
  });

  it("requires a data context to resolve officers", async () => {
    await expect(
      transform({
        paths: [],
        readXlsx,
        state: "/tmp",
        emit: async () => {},
      }),
    ).rejects.toThrow(/requires a data context/);
  });
});
