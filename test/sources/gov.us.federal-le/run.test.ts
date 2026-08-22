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

const page = `
<div id="mw-content-text"><div class="mw-parser-output">
  <h2>Department of Justice</h2>
  <ul>
    <li><a>Federal Bureau of Investigation (FBI)</a></li>
    <li><a>Drug Enforcement Administration (DEA)</a></li>
    <li><a>Fake Federal Bureau</a></li>
  </ul>
</div></div>`;

// FBI is complete -> imported. DEA has a blank address -> incomplete stub,
// skipped. Fake Federal Bureau has no entry at all -> skipped.
const locations = {
  agencies: [
    {
      slug: "federal-bureau-of-investigation",
      name: "Federal Bureau of Investigation (FBI)",
      state: "DC",
      city: "Washington",
      address: "935 Pennsylvania Avenue NW",
      zip_code: "20535",
    },
    {
      slug: "drug-enforcement-administration",
      name: "Drug Enforcement Administration (DEA)",
      state: "VA",
      city: "Springfield",
      address: "",
      zip_code: "22152",
    },
  ],
};

async function runWithState() {
  const dir = await mkdtemp(path.join(tmpdir(), "federal-le-"));
  tempDirs.push(dir);
  const htmlPath = path.join(dir, "federal-le.html");
  await writeFile(htmlPath, page);
  await writeFile(
    path.join(dir, "agency-locations.yaml"),
    stringifyYaml(locations),
  );
  return run({
    paths: [htmlPath],
    readXlsx,
    state: dir,
    emit: async () => {},
    logger: { info: () => {} },
  });
}

describe("gov.us.federal-le run", () => {
  it("emits parents, agencies with a complete state location, and branch links", async () => {
    const manifest = await runWithState();
    const byKind = Object.fromEntries(
      manifest.artifacts.map((a) => [a.kind, a.records]),
    );

    expect(Object.keys(byKind.FederalAgencies)).toEqual([
      "department-of-justice",
    ]);
    // Only FBI has a complete location; DEA (blank address) + Fake (no entry)
    // are skipped.
    expect(Object.keys(byKind.Agencies)).toEqual([
      "federal-bureau-of-investigation",
    ]);
    expect(byKind.Agencies["federal-bureau-of-investigation"].spec).toEqual({
      name: "Federal Bureau of Investigation (FBI)",
      state: "DC",
      city: "Washington",
      address: "935 Pennsylvania Avenue NW",
      zip_code: "20535",
    });
    expect(Object.keys(byKind.FederalAgencyBranches)).toEqual([
      "department-of-justice|federal-bureau-of-investigation",
    ]);
  });

  it("emits nothing importable when no locations file exists in state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "federal-le-"));
    tempDirs.push(dir);
    const htmlPath = path.join(dir, "federal-le.html");
    await writeFile(htmlPath, page);
    const manifest = await run({
      paths: [htmlPath],
      readXlsx,
      state: dir,
      emit: async () => {},
      logger: { info: () => {} },
    });
    const byKind = Object.fromEntries(
      manifest.artifacts.map((a) => [a.kind, a.records]),
    );
    expect(Object.keys(byKind.Agencies)).toEqual([]);
    expect(Object.keys(byKind.FederalAgencyBranches)).toEqual([]);
    // Parents still come straight from the page.
    expect(Object.keys(byKind.FederalAgencies)).toEqual([
      "department-of-justice",
    ]);
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
