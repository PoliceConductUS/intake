import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

// "Fake Federal Bureau" has no curated location -> skipped; FBI + DEA are in
// sources/gov.us.federal-le/agency-locations.yaml -> imported.
const page = `
<div id="mw-content-text"><div class="mw-parser-output">
  <h2>Department of Justice</h2>
  <ul>
    <li><a>Federal Bureau of Investigation (FBI)</a></li>
    <li><a>Drug Enforcement Administration (DEA)</a></li>
    <li><a>Fake Federal Bureau</a></li>
  </ul>
</div></div>`;

async function runWithPage(html: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "federal-le-"));
  tempDirs.push(dir);
  const htmlPath = path.join(dir, "federal-le.html");
  await writeFile(htmlPath, html);
  const emitted: Array<{ kind: string; key: string; spec: unknown }> = [];
  const manifest = await run({
    paths: [htmlPath],
    readXlsx,
    state: dir,
    emit: async (kind, key, spec) => {
      emitted.push({ kind, key, spec });
    },
    logger: { info: () => {} },
  });
  return manifest;
}

describe("gov.us.federal-le run", () => {
  it("emits parents, curated agencies, and their branch links", async () => {
    const manifest = await runWithPage(page);
    const byKind = Object.fromEntries(
      manifest.artifacts.map((a) => [a.kind, a.records]),
    );

    expect(Object.keys(byKind.FederalAgencies)).toEqual([
      "department-of-justice",
    ]);
    expect(byKind.FederalAgencies["department-of-justice"].spec).toEqual({
      name: "Department of Justice",
      slug: "department-of-justice",
    });

    // Fake Federal Bureau has no curated location -> skipped.
    expect(Object.keys(byKind.Agencies).sort()).toEqual([
      "drug-enforcement-administration",
      "federal-bureau-of-investigation",
    ]);
    expect(byKind.Agencies["federal-bureau-of-investigation"].spec).toEqual({
      name: "Federal Bureau of Investigation (FBI)",
      state: "DC",
      city: "Washington",
      address: "935 Pennsylvania Avenue NW",
      zip_code: "20535",
    });

    expect(Object.keys(byKind.FederalAgencyBranches).sort()).toEqual([
      "department-of-justice|drug-enforcement-administration",
      "department-of-justice|federal-bureau-of-investigation",
    ]);
    expect(
      byKind.FederalAgencyBranches[
        "department-of-justice|federal-bureau-of-investigation"
      ].spec,
    ).toEqual({
      federal_agency_id: "department-of-justice",
      agency_id: "federal-bureau-of-investigation",
    });
  });

  it("emits records that satisfy the generated specs", async () => {
    const manifest = await runWithPage(page);
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
