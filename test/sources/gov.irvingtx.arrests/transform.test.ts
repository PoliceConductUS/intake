import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { ArrestProfiles } from "../../../src/shared/io/index.js";
import { transform } from "../../../sources/gov.irvingtx.arrests/transform.js";
import type { NormalizedArrest } from "../../../sources/gov.irvingtx.arrests/arrest.js";
import type {
  TransformDataContext,
  SourceManifest,
} from "../../../src/cli/transform/source-transform.js";

const boundaries = [
  {
    code: "1",
    name: "1",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    },
  },
];
const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

// Roster knows Matthew Jones and Brendon Fowler at Irving PD; anyone else is
// unresolved (resolve-or-fail).
const data: TransformDataContext = {
  async resolveAgency({ agencyName }) {
    return agencyName === "Irving Police Department"
      ? { agencyId: "irving" }
      : null;
  },
  async resolvePersonnel({ agencyId, personnelName }) {
    if (agencyId !== "irving") return null;
    const officer = {
      "MATTHEW JONES": "ap-jones",
      "M JONES": "ap-jones",
      "BRENDON FOWLER": "ap-fowler",
    }[personnelName];
    return officer === undefined ? null : { agencyPersonnelId: officer };
  },
};

function arrest(overrides: Partial<NormalizedArrest>): NormalizedArrest {
  return {
    officerNames: ["MATTHEW JONES"],
    year: "2020",
    month: "2020-01",
    isoWeek: "2020-W01",
    dayOfWeek: "Wed",
    hour: "00",
    bookingNo: "1",
    sourceRowCount: 1,
    sourceDistrict: "3",
    charges: [{ code: "A", offense: "PUBLIC INTOXICATION", level: "MC" }],
    offenses: [],
    enrichment: {
      beat: null,
      beatStatus: "unavailable",
      incomeTract: null,
      income: null,
      incomeStatus: "unavailable",
    },
    ...overrides,
  };
}

function records(
  manifest: SourceManifest,
  kind: string,
): Record<string, { spec: unknown }> {
  const artifact = manifest.artifacts.find((a) => a.kind === kind);
  expect(artifact, `missing artifact ${kind}`).toBeDefined();
  return artifact!.records;
}

describe("arrests run", () => {
  it("emits one profile per resolved officer and reports unresolved names", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "arrests-"));
    tempDirs.push(dir);
    const state = path.join(dir, "state");
    await mkdir(state, { recursive: true });
    const jsonl = path.join(dir, "arrests-normalized.jsonl");
    const arrests = [
      arrest({
        officerNames: ["MATTHEW JONES", "M JONES"],
        year: "2020",
        bookingNo: "1",
      }),
      arrest({
        officerNames: ["MATTHEW JONES"],
        year: "2021",
        bookingNo: "2",
        charges: [{ code: "B", offense: "THEFT", level: "MC" }],
      }),
      arrest({
        officerNames: ["BRENDON FOWLER"],
        year: "2021",
        bookingNo: "3",
      }),
      arrest({
        officerNames: ["NOBODY KNOWN"],
        year: "2021",
        bookingNo: "4",
        charges: [],
      }),
    ];
    await writeFile(
      jsonl,
      arrests.map((a) => JSON.stringify(a)).join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(dir, "analytics-provenance.json"),
      JSON.stringify({
        beatBoundaries: boundaries,
        provenance: { workbookSha256: "hash" },
        audit: { sourceArrestRows: 4 },
      }),
    );
    const manifest = await transform({
      paths: [jsonl, path.join(dir, "analytics-provenance.json")],
      readXlsx: (() => {
        throw new Error("unused");
      }) as never,
      state,
      emit: async () => {},
      env: {},
      data,
    });

    expect(
      records(manifest, "AgencyArrestProfiles").irving?.spec,
    ).toMatchObject({
      agency_id: "irving",
      breakdowns: { arrest_beat_boundaries: boundaries },
      coverage: {
        totalArrests: 4,
        arrestsWithNoResolvedOfficer: 1,
        unresolvedNameCount: 1,
      },
    });
    expect(
      records(manifest, "AgencyArrestProfiles").irving?.spec,
    ).toMatchObject({
      coverage: {
        dataQualityFindings: [
          {
            code: "bookings_without_matching_charge_records",
            count: 1,
            totalBookings: 4,
            reason: "unknown",
          },
        ],
      },
    });
    const profiles = records(manifest, "ArrestProfiles");
    expect(Object.keys(profiles).sort()).toEqual(["ap-fowler", "ap-jones"]);

    const jones = profiles["ap-jones"]!.spec as {
      agency_personnel_id: string;
      coverage: { totalArrests: number };
      breakdowns: Record<string, Record<string, number>>;
    };
    expect(jones.agency_personnel_id).toBe("ap-jones");
    expect(jones.coverage.totalArrests).toBe(2);
    expect(jones.breakdowns.by_year).toEqual({ "2020": 1, "2021": 1 });
    expect(jones.breakdowns.arrests_by_offense).toEqual({
      "PUBLIC INTOXICATION": 1,
      THEFT: 1,
    });

    const report = JSON.parse(
      await readFile(path.join(state, "arrest-report.json"), "utf8"),
    ) as {
      totalArrests: number;
      officersProfiled: number;
      unresolvedNameCount: number;
      arrestsWithNoResolvedOfficer: number;
    };
    expect(report.totalArrests).toBe(4);
    expect(report.officersProfiled).toBe(2);
    expect(report.unresolvedNameCount).toBe(1);
    expect(report.arrestsWithNoResolvedOfficer).toBe(1);
  });

  it("round trips more than 100 officer profiles through canonical IO without shared aliases", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "arrests-"));
    tempDirs.push(dir);
    const jsonl = path.join(dir, "arrests-normalized.jsonl");
    const provenancePath = path.join(dir, "analytics-provenance.json");
    const income = {
      estimate: 50000,
      marginOfError: 1000,
      annotation: null,
      marginOfErrorAnnotation: null,
      topcoded: false,
    };
    const arrests = Array.from({ length: 150 }, (_, i) =>
      arrest({
        bookingNo: String(i),
        officerNames: [`OFFICER ${i}`],
        enrichment: {
          beat: "1",
          beatStatus: "matched",
          incomeTract: "tract",
          income,
          incomeStatus: "matched",
        },
      }),
    );
    await writeFile(jsonl, arrests.map((a) => JSON.stringify(a)).join("\n"));
    await writeFile(
      provenancePath,
      JSON.stringify({
        beatBoundaries: boundaries,
        provenance: {
          workbook: { sha256: "hash" },
          census: { vintage: "2024" },
        },
        audit: {},
      }),
    );
    const manifest = await transform({
      paths: [jsonl, provenancePath],
      readXlsx: (() => {
        throw new Error("unused");
      }) as never,
      state: dir,
      emit: async () => {},
      env: {},
      data: {
        ...data,
        async resolvePersonnel({ personnelName }) {
          return { agencyPersonnelId: personnelName };
        },
      },
    });
    const artifact = manifest.artifacts.find(
      (a) => a.kind === "ArrestProfiles",
    )!;
    const envelope = ArrestProfiles.schema.parse({
      apiVersion: "policeconduct.org/intake/v1alpha1",
      kind: "ArrestProfiles",
      metadata: { namespace: "test", name: "profiles" },
      spec: { records: artifact.records },
    });
    const written = await ArrestProfiles.write(dir, envelope);
    const read = await ArrestProfiles.read(written.path, { raw: true });
    expect(Object.keys(read.spec.records)).toHaveLength(150);
    expect(read.spec.records["OFFICER 149"]?.spec.coverage).toMatchObject({
      totalArrests: 1,
      provenance: { workbook: { sha256: "hash" } },
    });
  });

  it("rejects obsolete normalized records and requires acquisition provenance", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "arrests-"));
    tempDirs.push(dir);
    const jsonl = path.join(dir, "arrests-normalized.jsonl");
    const context = {
      paths: [jsonl],
      readXlsx: (() => {
        throw new Error("unused");
      }) as never,
      state: dir,
      emit: async () => {},
      env: {},
      data,
    };
    await writeFile(
      jsonl,
      JSON.stringify({ officerNames: [], offense: "THEFT", chargeLevel: "MC" }),
    );
    await expect(transform(context)).rejects.toThrow();
    await writeFile(jsonl, JSON.stringify(arrest({})));
    await expect(transform(context)).rejects.toThrow(/analytics-provenance/);
  });

  it("fails loud when the agency does not resolve", async () => {
    const noAgency: TransformDataContext = {
      ...data,
      async resolveAgency() {
        return null;
      },
    };
    const dir = await mkdtemp(path.join(tmpdir(), "arrests-"));
    tempDirs.push(dir);
    const jsonl = path.join(dir, "arrests-normalized.jsonl");
    await writeFile(jsonl, JSON.stringify(arrest({})), "utf8");
    await writeFile(
      path.join(dir, "analytics-provenance.json"),
      JSON.stringify({ provenance: {}, audit: {}, beatBoundaries: boundaries }),
    );
    await expect(
      transform({
        paths: [jsonl, path.join(dir, "analytics-provenance.json")],
        readXlsx: (() => {
          throw new Error("unused");
        }) as never,
        state: dir,
        emit: async () => {},
        env: {},
        data: noAgency,
      }),
    ).rejects.toThrow(/does not resolve to an agency/);
  });
});
