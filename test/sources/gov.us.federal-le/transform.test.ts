import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { afterEach, describe, it, expect } from "vitest";
import { transform } from "../../../sources/org/wikipedia/en/us-federal-law-enforcement-agencies/transform.js";
import { readXlsx } from "../../../src/cli/transform/read-xlsx.js";
import { AgencySpec, FederalAgencySpec } from "../../../src/shared/io/index.js";

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
  ],
};

async function runWithState(
  orgsFile: unknown = orgs,
  officesFile: unknown = offices,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "federal-le-"));
  tempDirs.push(dir);
  await writeFile(
    path.join(dir, "federal-agencies.yaml"),
    stringifyYaml(orgsFile),
  );
  await writeFile(path.join(dir, "offices.yaml"), stringifyYaml(officesFile));
  return transform({
    paths: [],
    readXlsx,
    state: dir,
    emit: async () => {},
    logger: { info: () => {} },
  });
}

describe("org/wikipedia/en/us-federal-law-enforcement-agencies run", () => {
  it("emits federal agencies and complete offices with their parent reference", async () => {
    const manifest = await runWithState();
    const byKind = Object.fromEntries(
      manifest.artifacts.map((a) => [a.kind, a.records]),
    );
    expect(Object.keys(byKind).sort()).toEqual(["Agencies", "FederalAgencies"]);

    expect(Object.keys(byKind.FederalAgencies).sort()).toEqual(["dea", "fbi"]);
    expect(byKind.FederalAgencies.fbi.spec).toEqual({
      name: "Federal Bureau of Investigation (FBI)",
      slug: "fbi",
    });

    expect(Object.keys(byKind.Agencies).sort()).toEqual([
      "fbi-hq",
      "fbi-new-york",
    ]);
    expect(byKind.Agencies["fbi-new-york"].spec).toEqual({
      parent_federal_agency_id: "fbi",
      name: "FBI New York Field Office",
      state: "NY",
      city: "New York",
      address: "26 Federal Plaza",
      zip_code: "10278",
    });
  });

  it("emits records that satisfy the generated specs", async () => {
    const manifest = await runWithState();
    for (const artifact of manifest.artifacts) {
      const spec =
        artifact.kind === "FederalAgencies" ? FederalAgencySpec : AgencySpec;
      for (const record of Object.values(artifact.records)) {
        expect(spec.parse(record.spec)).toBeTruthy();
      }
    }
  });

  it("accounts for every agency and office it reads", async () => {
    const manifest = await runWithState();
    expect(manifest.accounting).toEqual([
      {
        input: "federal-agencies.yaml",
        read: 2,
        emitted: 2,
        reported: 0,
        notSelected: {},
      },
      {
        input: "offices.yaml",
        read: 2,
        emitted: 2,
        reported: 0,
        notSelected: {},
      },
    ]);
  });

  const withOffice = (change: Record<string, unknown>) => ({
    offices: [offices.offices[0], { ...offices.offices[1], ...change }],
  });

  it("throws for an office with a blank field", async () => {
    await expect(
      runWithState(orgs, withOffice({ address: " " })),
    ).rejects.toThrow(
      /us-federal-law-enforcement-agencies: offices\.yaml is not valid[\s\S]*offices\.1\.address/,
    );
  });

  it("throws for an office with a missing field", async () => {
    await expect(
      runWithState(orgs, withOffice({ city: undefined })),
    ).rejects.toThrow(/offices\.yaml is not valid[\s\S]*offices\.1\.city/);
  });

  it("throws a named error for a zip_code that is a number", async () => {
    await expect(
      runWithState(orgs, withOffice({ zip_code: 10278 })),
    ).rejects.toThrow(/offices\.yaml is not valid[\s\S]*offices\.1\.zip_code/);
  });

  it("throws for a key the office does not have", async () => {
    await expect(
      runWithState(orgs, withOffice({ phone: "555-0100" })),
    ).rejects.toThrow(/offices\.yaml is not valid[\s\S]*phone/);
  });

  it("throws for a file whose list key is missing", async () => {
    await expect(runWithState(orgs, { office: [] })).rejects.toThrow(
      /offices\.yaml is not valid/,
    );
  });

  it("throws for an office that names an agency not in the curated list", async () => {
    await expect(
      runWithState(orgs, withOffice({ federal_agency: "atf" })),
    ).rejects.toThrow(
      "org/wikipedia/en/us-federal-law-enforcement-agencies: offices.yaml office fbi-new-york names federal agency atf, which is not in federal-agencies.yaml",
    );
  });

  it("throws for a repeated office slug", async () => {
    await expect(
      runWithState(orgs, withOffice({ slug: "fbi-hq" })),
    ).rejects.toThrow(
      "org/wikipedia/en/us-federal-law-enforcement-agencies: offices.yaml repeats slug fbi-hq",
    );
  });

  it("throws for a repeated agency slug", async () => {
    await expect(
      runWithState({
        agencies: [...orgs.agencies, { slug: "fbi", name: "Other" }],
      }),
    ).rejects.toThrow(
      "org/wikipedia/en/us-federal-law-enforcement-agencies: federal-agencies.yaml repeats slug fbi",
    );
  });
});
