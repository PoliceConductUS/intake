import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { transform } from "../../../../../sources/com/youtube/policeactivity/transform.js";
import { readXlsx } from "../../../../../src/cli/transform/read-xlsx.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

const envelope = {
  agency: { id: "a1", name: "Irving Police Department", state: "TX" },
  channelId: "UCpolice",
  videos: [
    {
      videoId: "v1",
      url: "https://www.youtube.com/watch?v=v1",
      title: "Bodycam: Irving PD arrest",
      description:
        "Officer John Smith responds to a call. Sergeant Jane Wilson also arrived on scene. Case 3:23-cv-01234.",
      publishedAt: "2024-03-05T12:00:00Z",
      channelId: "UCpolice",
    },
    {
      // Names an officer who does not resolve at this agency -> no link.
      videoId: "v2",
      url: "https://www.youtube.com/watch?v=v2",
      title: "Traffic stop",
      // A docket mention does not substitute for a resolved officer.
      description:
        "Officer Nobody Stranger writes a ticket. Case 3:23-cv-01234.",
      publishedAt: "2024-01-01T00:00:00Z",
      channelId: "UCpolice",
    },
    {
      // Names no officer -> no link.
      videoId: "v3",
      url: "https://www.youtube.com/watch?v=v3",
      title: "Dashcam highlights",
      description: "General footage, no one named.",
      publishedAt: "2024-02-02T00:00:00Z",
      channelId: "UCpolice",
    },
  ],
};

// Fake run-phase resolver: only John Smith and Jane Wilson exist at agency a1.
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

async function transformFiles(
  contents: Record<string, unknown>,
  data = fakeData(),
) {
  const dir = await mkdtemp(path.join(tmpdir(), "youtube-pa-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(contents)) {
    await writeFile(path.join(dir, name), JSON.stringify(content));
  }
  return transform({
    paths: [dir],
    readXlsx,
    state: dir,
    emit: async () => {},
    data,
  });
}

async function runWith(data = fakeData()) {
  const dir = await mkdtemp(path.join(tmpdir(), "youtube-pa-"));
  tempDirs.push(dir);
  const file = path.join(dir, "a1.videos.json");
  await writeFile(file, JSON.stringify(envelope));
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

describe("com/youtube/policeactivity run", () => {
  it("links a video to every officer it names that resolves at the acquired agency", async () => {
    const { byKind } = await runWith();

    // Only v1 has resolvable officers.
    expect(Object.keys(byKind.CoverageLinks)).toEqual(["v1"]);
    expect(byKind.CoverageLinks.v1.spec).toEqual({
      url: "https://www.youtube.com/watch?v=v1",
      normalized_url: "https://www.youtube.com/watch?v=v1",
      title: "Bodycam: Irving PD arrest",
      source_name: "PoliceActivity",
      published_at: "2024-03-05",
      notes:
        "Officer John Smith responds to a call. Sergeant Jane Wilson also arrived on scene. Case 3:23-cv-01234.",
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

  it("links no officer named only in caption text a video file still holds", async () => {
    const data = fakeData();
    const manifest = await transformFiles(
      {
        "a1.videos.json": {
          ...envelope,
          videos: [
            {
              ...envelope.videos[2],
              captions: "Sergeant Jane Wilson also arrived on scene.",
            },
          ],
        },
      },
      data,
    );
    expect(data.calls).toEqual([]);
    expect(manifest.artifacts.map((a) => Object.keys(a.records))).toEqual([
      [],
      [],
    ]);
  });

  it("emits no coverage link for an unresolvable or unnamed video", async () => {
    const { byKind } = await runWith();
    expect(Object.keys(byKind.CoverageLinks)).not.toContain("v2");
    expect(Object.keys(byKind.CoverageLinks)).not.toContain("v3");
  });

  it("emits only video coverage and personnel links when a video cites a docket", async () => {
    const { byKind } = await runWith();
    expect(Object.keys(byKind).sort()).toEqual([
      "CoverageLinkAgencyPersonnel",
      "CoverageLinks",
    ]);
  });

  it("resolves each mention scoped to the acquired agency", async () => {
    const data = fakeData();
    await runWith(data);
    // Every resolve call is scoped to a1, and no officer is minted.
    expect(data.calls.every((c) => c.agencyId === "a1")).toBe(true);
    expect(data.calls.map((c) => c.personnelName)).toContain("John Smith");
  });

  it("is deterministic", async () => {
    const first = (await runWith()).manifest;
    const second = (await runWith()).manifest;
    expect(second).toEqual(first);
  });

  it("counts every video once: emitted, or not selected because it names no officer the database knows", async () => {
    const { manifest } = await runWith();
    expect(manifest.accounting).toEqual([
      {
        input: "videos",
        read: 3,
        emitted: 1,
        reported: 0,
        notSelected: { "names no officer the database knows": 2 },
      },
    ]);
  });

  it("throws on a file with no agency ID", async () => {
    await expect(
      transformFiles({
        "x.videos.json": { ...envelope, agency: { name: "Irving PD" } },
      }),
    ).rejects.toThrow(/x\.videos\.json has no agency ID or name/);
  });

  it("throws on a file with no agency name", async () => {
    await expect(
      transformFiles({
        "x.videos.json": { ...envelope, agency: { id: "a1", name: " " } },
      }),
    ).rejects.toThrow(/x\.videos\.json has no agency ID or name/);
  });

  it("throws on a file with no videos list", async () => {
    await expect(
      transformFiles({ "x.videos.json": { agency: envelope.agency } }),
    ).rejects.toThrow(/x\.videos\.json has no videos list/);
  });

  it("throws on a video with no title, naming the file and the video", async () => {
    await expect(
      transformFiles({
        "x.videos.json": {
          ...envelope,
          videos: [{ ...envelope.videos[0], title: "" }],
        },
      }),
    ).rejects.toThrow(
      /x\.videos\.json video 1 \("v1"\) has no video ID, URL or title/,
    );
  });

  it("throws on a video whose published date is not a date", async () => {
    await expect(
      transformFiles({
        "x.videos.json": {
          ...envelope,
          videos: [{ ...envelope.videos[0], publishedAt: "last week" }],
        },
      }),
    ).rejects.toThrow(/x\.videos\.json video 1 \("v1"\).*"last week"/);
  });

  it("throws on an input path that does not exist", async () => {
    const missing = path.join(tmpdir(), "youtube-pa-missing-input");
    await expect(
      transform({
        paths: [missing],
        readXlsx,
        state: missing,
        emit: async () => {},
        data: fakeData(),
      }),
    ).rejects.toThrow(/ENOENT.*youtube-pa-missing-input/);
  });

  it("throws on an input path that is not a directory of video files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "youtube-pa-"));
    tempDirs.push(dir);
    const file = path.join(dir, "channel.json");
    await writeFile(file, "{}");
    await expect(
      transform({
        paths: [file],
        readXlsx,
        state: dir,
        emit: async () => {},
        data: fakeData(),
      }),
    ).rejects.toThrow(/ENOTDIR/);
  });

  it("emits one coverage link for a video two agency files hold with the same content", async () => {
    const manifest = await transformFiles({
      "a1.videos.json": envelope,
      "a2.videos.json": {
        ...envelope,
        agency: { id: "a2", name: "Dallas Police Department", state: "TX" },
      },
    });
    const links = manifest.artifacts.find((a) => a.kind === "CoverageLinks");
    expect(Object.keys(links?.records ?? {})).toEqual(["v1"]);
    expect(manifest.accounting[0]).toMatchObject({ read: 6, emitted: 2 });
  });

  it("throws when two agency files hold one video with different content", async () => {
    await expect(
      transformFiles({
        "a1.videos.json": envelope,
        "a2.videos.json": {
          ...envelope,
          agency: { id: "a2", name: "Dallas Police Department", state: "TX" },
          videos: [{ ...envelope.videos[0], title: "Edited title" }],
        },
      }),
    ).rejects.toThrow(
      /video v1 in .*a2\.videos\.json differs from .*a1\.videos\.json/,
    );
  });
});
