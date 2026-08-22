import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  EmittedRecords,
  RunDeps,
  SourceRun,
} from "../../src/cli/run/source-run.js";
import {
  OFFICES_FILE,
  ORGS_FILE,
  officeIsComplete,
  type Office,
  type Org,
} from "./model.js";

export const description =
  "US federal law-enforcement agencies — each agency (FBI, DEA, …) as a federal_agency, its offices (HQ + field offices) as agency records, linked by federal_agency_branch. Agencies are discovered from Wikipedia; offices are curated in state.";

async function loadYamlList<T>(
  stateDir: string,
  file: string,
  key: string,
): Promise<T[]> {
  const filePath = path.join(stateDir, file);
  try {
    await access(filePath);
  } catch {
    return [];
  }
  const parsed = parseYaml(await readFile(filePath, "utf8")) as Record<
    string,
    T[] | undefined
  >;
  return parsed[key] ?? [];
}

export const run: SourceRun = async ({ state, logger }: RunDeps) => {
  const log = logger ?? { info() {} };
  const orgs = await loadYamlList<Org>(state, ORGS_FILE, "agencies");
  const offices = await loadYamlList<Office>(state, OFFICES_FILE, "offices");
  const orgSlugs = new Set(orgs.map((org) => org.slug));

  const federalAgencies: EmittedRecords = {};
  for (const org of orgs) {
    federalAgencies[org.slug] = { spec: { name: org.name, slug: org.slug } };
  }

  const agencies: EmittedRecords = {};
  const branches: EmittedRecords = {};
  const skipped: string[] = [];
  for (const office of offices) {
    if (!officeIsComplete(office) || !orgSlugs.has(office.federal_agency)) {
      skipped.push(office.name || office.slug || "(unnamed office)");
      continue;
    }
    agencies[office.slug] = {
      spec: {
        name: office.name,
        state: office.state,
        city: office.city,
        address: office.address,
        zip_code: office.zip_code,
      },
    };
    branches[`${office.federal_agency}|${office.slug}`] = {
      spec: {
        federal_agency_id: office.federal_agency,
        agency_id: office.slug,
      },
    };
  }

  log.info(
    `federal-le: ${Object.keys(federalAgencies).length} agencies, ` +
      `${Object.keys(agencies).length} offices, ` +
      `${Object.keys(branches).length} branches, ` +
      `${skipped.length} offices skipped (incomplete or unknown agency)`,
  );
  if (skipped.length > 0) {
    log.info(`federal-le: fix ${OFFICES_FILE} in state: ${skipped.join("; ")}`);
  }

  return {
    artifacts: [
      { kind: "FederalAgencies", records: federalAgencies },
      { kind: "Agencies", records: agencies },
      { kind: "FederalAgencyBranches", records: branches },
    ],
  };
};
