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

const envelope = {
  agency: { id: "a1", name: "Irving Police Department", state: "TX" },
  channelId: "UCpolice",
  videos: [
    {
      videoId: "v1",
      url: "https://www.youtube.com/watch?v=v1",
      title: "Bodycam: Irving PD arrest",
      description: "Officer John Smith responds to a call. Case 3:23-cv-01234.",
      publishedAt: "2024-03-05T12:00:00Z",
      channelId: "UCpolice",
      captions: "Sergeant Jane Wilson also arrived on scene.",
    },
    {
      // Names an officer who does not resolve at this agency -> no link.
      videoId: "v2",
      url: "https://www.youtube.com/watch?v=v2",
      title: "Traffic stop",
      // Cites a resolvable docket but matches no officer -> still no case link.
      description:
        "Officer Nobody Stranger writes a ticket. Case 3:23-cv-01234.",
      publishedAt: "2024-01-01T00:00:00Z",
      channelId: "UCpolice",
      captions: null,
    },
    {
      // Names no officer -> no link.
      videoId: "v3",
      url: "https://www.youtube.com/watch?v=v3",
      title: "Dashcam highlights",
      description: "General footage, no one named.",
      publishedAt: "2024-02-02T00:00:00Z",
      channelId: "UCpolice",
      captions: null,
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
    // Only docket 3:23-cv-01234 matches an existing case.
    resolveCivilCase: async ({ docket }: { docket: string }) =>
      docket === "3:23-cv-01234" ? { civilCaseId: "txnd:323cv01234" } : null,
  };
}

async function runWith(data = fakeData()) {
  const dir = await mkdtemp(path.join(tmpdir(), "youtube-pa-"));
  tempDirs.push(dir);
  const file = path.join(dir, "irving-police-department.videos.json");
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

describe("youtube.policeactivity run", () => {
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
      notes: "Officer John Smith responds to a call. Case 3:23-cv-01234.",
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

  it("links a cited case only when the video also matched an officer", async () => {
    const { byKind } = await runWith();
    // v1 matched officers and cites a resolvable docket → one case link.
    // v2 cites the same resolvable docket but matched no officer → none.
    expect(byKind.CoverageLinkCivilCases).toEqual({
      "v1|txnd:323cv01234": {
        spec: {
          coverage_link_id: "v1",
          civil_case_id: "txnd:323cv01234",
          notes: "3:23-cv-01234",
        },
      },
    });
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
});
