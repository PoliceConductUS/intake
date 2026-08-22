import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { afterEach, describe, it, expect } from "vitest";
import { run } from "../../../sources/gov.us.federal-le/run.js";
import { readXlsx } from "../../../src/cli/run/read-xlsx.js";
import {
  AgencySpec,
  FederalAgencySpec,
  FederalAgencyBranchSpec,
} from "../../../src/shared/io/index.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

const orgs = {
  agencies: [
    { slug: "fbi", name: "Federal Bureau of Investigation (FBI)" },
    { slug: "dea", name: "Drug Enforcement Administration (DEA)" },
  ],
};

const offices = {
  offices: [
    {
      federal_agency: "fbi",
      slug: "fbi-hq",
      name: "FBI Headquarters",
      state: "DC",
      city: "Washington",
      address: "935 Pennsylvania Avenue NW",
      zip_code: "20535",
    },
    {
      federal_agency: "fbi",
      slug: "fbi-new-york",
      name: "FBI New York Field Office",
      state: "NY",
      city: "New York",
      address: "26 Federal Plaza",
      zip_code: "10278",
    },
    // incomplete (blank address) -> skipped
    {
      federal_agency: "dea",
      slug: "dea-hq",
      name: "DEA Headquarters",
      state: "VA",
      city: "Springfield",
      address: "",
      zip_code: "22152",
    },
    // references an agency not in federal-agencies.yaml -> skipped
    {
      federal_agency: "unknown",
      slug: "mystery-office",
      name: "Mystery Office",
      state: "TX",
      city: "Austin",
      address: "1 Main St",
      zip_code: "78701",
    },
  ],
};

async function runWithState() {
  const dir = await mkdtemp(path.join(tmpdir(), "federal-le-"));
  tempDirs.push(dir);
  await writeFile(path.join(dir, "federal-agencies.yaml"), stringifyYaml(orgs));
  await writeFile(path.join(dir, "offices.yaml"), stringifyYaml(offices));
  return run({
    paths: [],
    readXlsx,
    state: dir,
    emit: async () => {},
    logger: { info: () => {} },
  });
}

describe("gov.us.federal-le run", () => {
  it("emits each LE agency as a federal_agency, its complete offices as agencies, and branch links", async () => {
    const manifest = await runWithState();
    const byKind = Object.fromEntries(
      manifest.artifacts.map((a) => [a.kind, a.records]),
    );

    expect(Object.keys(byKind.FederalAgencies).sort()).toEqual(["dea", "fbi"]);
    expect(byKind.FederalAgencies.fbi.spec).toEqual({
      name: "Federal Bureau of Investigation (FBI)",
      slug: "fbi",
    });

    // fbi-hq + fbi-new-york are complete; dea-hq (blank address) and
    // mystery-office (unknown agency) are skipped.
    expect(Object.keys(byKind.Agencies).sort()).toEqual([
      "fbi-hq",
      "fbi-new-york",
    ]);
    expect(byKind.Agencies["fbi-new-york"].spec).toEqual({
      name: "FBI New York Field Office",
      state: "NY",
      city: "New York",
      address: "26 Federal Plaza",
      zip_code: "10278",
    });

    expect(Object.keys(byKind.FederalAgencyBranches).sort()).toEqual([
      "fbi|fbi-hq",
      "fbi|fbi-new-york",
    ]);
    expect(byKind.FederalAgencyBranches["fbi|fbi-hq"].spec).toEqual({
      federal_agency_id: "fbi",
      agency_id: "fbi-hq",
    });
  });

  it("emits records that satisfy the generated specs", async () => {
    const manifest = await runWithState();
    for (const artifact of manifest.artifacts) {
      const spec =
        artifact.kind === "FederalAgencies"
          ? FederalAgencySpec
          : artifact.kind === "FederalAgencyBranches"
            ? FederalAgencyBranchSpec
            : AgencySpec;
      for (const record of Object.values(artifact.records)) {
        expect(spec.parse(record.spec)).toBeTruthy();
      }
    }
  });
});
