import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  EmittedRecords,
  RunDeps,
  SourceRun,
} from "../../src/cli/run/source-run.js";
import { parseFederalLeAgencies, slugify } from "./acquire/parse.js";
import { SOURCE_HTML_FILE } from "./acquire.js";
import { LOCATIONS_FILE, type AgencyLocation } from "./locations.js";

export const description =
  "US federal law-enforcement agencies — parent departments, their agencies, and the parent→agency links, from the Wikipedia federal LE list joined to curated HQ locations in state.";

function isComplete(location: AgencyLocation): boolean {
  return (
    (location.state ?? "").trim() !== "" &&
    (location.city ?? "").trim() !== "" &&
    (location.address ?? "").trim() !== "" &&
    (location.zip_code ?? "").trim() !== ""
  );
}

async function loadAgencyLocations(
  stateDir: string,
): Promise<Map<string, AgencyLocation>> {
  const filePath = path.join(stateDir, LOCATIONS_FILE);
  try {
    await access(filePath);
  } catch {
    return new Map();
  }
  const parsed = parseYaml(await readFile(filePath, "utf8")) as {
    agencies?: AgencyLocation[];
  };
  return new Map(
    (parsed.agencies ?? []).map((location) => [location.slug, location]),
  );
}

export const run: SourceRun = async ({ paths, state, logger }: RunDeps) => {
  const log = logger ?? { info() {} };
  const htmlPath = paths.find((p) => path.basename(p) === SOURCE_HTML_FILE);
  if (htmlPath === undefined) {
    throw new Error(
      `gov.us.federal-le expects the acquired ${SOURCE_HTML_FILE} input.`,
    );
  }

  log.info("federal-le: parsing agency list");
  const { parents } = parseFederalLeAgencies(await readFile(htmlPath, "utf8"));
  const locations = await loadAgencyLocations(state);

  const federalAgencies: EmittedRecords = {};
  const agencies: EmittedRecords = {};
  const branches: EmittedRecords = {};
  const claimedAgencies = new Set<string>();
  const skipped: string[] = [];

  for (const parent of parents) {
    federalAgencies[parent.slug] = {
      spec: { name: parent.name, slug: parent.slug },
    };
    for (const agencyName of parent.agencies) {
      const slug = slugify(agencyName);
      const location = locations.get(slug);
      if (location === undefined || !isComplete(location)) {
        skipped.push(agencyName);
        continue;
      }
      if (claimedAgencies.has(slug)) continue;
      claimedAgencies.add(slug);

      agencies[slug] = {
        spec: {
          name: location.name,
          state: location.state,
          city: location.city,
          address: location.address,
          zip_code: location.zip_code,
        },
      };
      branches[`${parent.slug}|${slug}`] = {
        spec: { federal_agency_id: parent.slug, agency_id: slug },
      };
    }
  }

  log.info(
    `federal-le: ${Object.keys(federalAgencies).length} parents, ` +
      `${Object.keys(agencies).length} agencies, ` +
      `${Object.keys(branches).length} branches, ` +
      `${skipped.length} skipped (no complete location in state)`,
  );
  if (skipped.length > 0) {
    log.info(
      `federal-le: fill ${LOCATIONS_FILE} in state to import: ${skipped.join("; ")}`,
    );
  }

  return {
    artifacts: [
      { kind: "FederalAgencies", records: federalAgencies },
      { kind: "Agencies", records: agencies },
      { kind: "FederalAgencyBranches", records: branches },
    ],
  };
};
