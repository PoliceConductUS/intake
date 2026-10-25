import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { transform } from "../../../sources/youtube.policeactivity/transform.js";
import { readXlsx } from "../../../src/cli/transform/read-xlsx.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

// The window a run on 2026-10-24 acquired this evidence under, stamped on the
// envelope so the produce phase needs no clock of its own.
const window = {
  start: "2021-10-24T00:00:00.000Z",
  end: "2026-10-24T00:00:00.000Z",
};

const source = {
  name: "PoliceActivity",
  handle: "@PoliceActivity",
  channelUrl: "https://www.youtube.com/PoliceActivity",
  channelId: "UCpa123",
};

function video(overrides: Record<string, unknown>) {
  return {
    videoId: "v1",
    url: "https://www.youtube.com/watch?v=v1",
    title: "Bodycam: Irving PD arrest",
    description: "Officer John Smith responds to a call.",
    publishedAt: "2024-03-05T12:00:00Z",
    channelId: "UCpa123",
    retrievedAt: "2026-10-24T00:00:00.000Z",
    ...overrides,
  };
}

const videos = [
  video({
    description:
      "Officer John Smith responds to a call. Sergeant Jane Wilson also arrived.",
  }),
  // Names an officer who does not resolve at this agency -> no link.
  video({
    videoId: "v2",
    url: "https://www.youtube.com/watch?v=v2",
    title: "Traffic stop",
    description: "Officer Nobody Stranger writes a ticket.",
    publishedAt: "2024-01-01T00:00:00Z",
  }),
  // Names no officer -> no link.
  video({
    videoId: "v3",
    url: "https://www.youtube.com/watch?v=v3",
    title: "Dashcam highlights",
    description: "General footage, no one named.",
    publishedAt: "2024-02-02T00:00:00Z",
  }),
];

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    source,
    window,
    agency: {
      id: "a1",
      name: "Irving Police Department",
      state: "TX",
      county: "Dallas",
      place: "Irving",
    },
    videos,
    ...overrides,
  };
}

// Fake produce-phase resolver: only John Smith and Jane Wilson exist at agency a1.
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
  body: unknown = envelope(),
) {
  const dir = await mkdtemp(path.join(tmpdir(), "youtube-pa-"));
  tempDirs.push(dir);
  const file = path.join(dir, "irving-police-department.videos.json");
  await writeFile(file, JSON.stringify(body));
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

describe("youtube.policeactivity produce", () => {
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
        "Officer John Smith responds to a call. Sergeant Jane Wilson also arrived.",
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

  it("emits no coverage link for an unresolvable or unnamed video", async () => {
    const { byKind } = await runWith();
    expect(Object.keys(byKind.CoverageLinks)).not.toContain("v2");
    expect(Object.keys(byKind.CoverageLinks)).not.toContain("v3");
  });

  it("emits only the two coverage kinds it declares", async () => {
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

  it("ignores a video published outside the acquired window", async () => {
    const data = fakeData();
    const { byKind } = await runWith(
      data,
      envelope({
        videos: [
          video({
            videoId: "aged-out",
            publishedAt: "2021-10-23T00:00:00Z",
            description: "Officer John Smith responds to a call.",
          }),
        ],
      }),
    );
    expect(byKind.CoverageLinks).toEqual({});
    // Out-of-window evidence is not even resolved against the database.
    expect(data.calls).toEqual([]);
  });

  it("links a previously skipped video once the officer it names exists", async () => {
    const skipped = envelope({
      videos: [
        video({
          videoId: "v9",
          url: "https://www.youtube.com/watch?v=v9",
          title: "Bodycam: arrest",
          description: "Officer Later Hire makes an arrest.",
          publishedAt: "2024-06-01T00:00:00Z",
        }),
      ],
    });

    // First run: the officer is not in the database yet.
    const before = await runWith(fakeData(), skipped);
    expect(before.byKind.CoverageLinks).toEqual({});

    // A later run over the same evidence, after the officer and agency exist.
    const after = await runWith(fakeData({ "Later Hire": "ao-9" }), skipped);
    expect(Object.keys(after.byKind.CoverageLinks)).toEqual(["v9"]);
    expect(Object.keys(after.byKind.CoverageLinkAgencyPersonnel)).toEqual([
      "v9|ao-9",
    ]);
  });

  it("is deterministic, so a re-run over unchanged evidence duplicates nothing", async () => {
    const first = (await runWith()).manifest;
    const second = (await runWith()).manifest;
    expect(second).toEqual(first);
  });

  it("rejects evidence with no window stamp", async () => {
    const { window: _dropped, ...noWindow } = envelope();
    await expect(runWith(fakeData(), noWindow)).rejects.toThrow(
      /not a valid video evidence envelope/,
    );
  });

  it("rejects evidence with no retrieval time", async () => {
    const { retrievedAt: _dropped, ...noRetrievedAt } = video({});
    await expect(
      runWith(fakeData(), envelope({ videos: [noRetrievedAt] })),
    ).rejects.toThrow(/not a valid video evidence envelope/);
  });

  it("requires a data context to resolve officers against", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "youtube-pa-"));
    tempDirs.push(dir);
    await expect(
      transform({
        paths: [path.join(dir, "x.videos.json")],
        readXlsx,
        state: dir,
        emit: async () => {},
      }),
    ).rejects.toThrow(/requires a data context/);
  });
});
