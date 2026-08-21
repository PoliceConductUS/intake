import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type AgencyMatch = {
  Id: string;
  Licensee__c?: string;
  Organization_Name__c?: string;
};
export type AgencyMatchResult = {
  agencyName: string;
  recordCount?: number;
  candidateMatches: AgencyMatch[];
  matches: AgencyMatch[];
  allowEmptyAgencySearch?: boolean;
};
export type OfficerRow = Record<string, unknown> & {
  contactId?: string;
  licenseId?: string;
};
export type OfficerDetail = {
  education?: unknown;
  disciplinaryActions?: unknown;
  activeEmployment?: unknown;
  licenses?: unknown;
};

export type AgencyFilters = {
  allowEmptyAgencySearch: string[];
  supplementalAgencies: Array<{ agencyName: string } & Record<string, unknown>>;
};

export type AgencyCsv = { body: string; citation: unknown };

export type PostClient = {
  searchAgency(agencyName: string): Promise<AgencyMatchResult>;
  fetchOfficerList(match: AgencyMatch): Promise<OfficerRow[]>;
  fetchOfficerDetail(officer: OfficerRow): Promise<OfficerDetail>;
};

export type CollectLogger = { info: (message: string) => void };
const silentLogger: CollectLogger = { info() {} };

export type CollectDeps = {
  sourceDir: string;
  agencyFilters: AgencyFilters;
  fetchAgencyCsv: () => Promise<AgencyCsv>;
  client: PostClient;
  logger?: CollectLogger;
};

/**
 * Download every raw input the produce phase needs, preserving the site's own
 * format — csv stays csv, json stays json, nothing is re-serialized to YAML:
 *
 *   - `agencies/agencies.csv`          the raw agency list
 *   - `agencies/<stem>.matches.json`   the raw agency search result (per agency)
 *   - `officers/<stem>.roster.json`    the raw officer list (per agency)
 *   - `officers/<stem>.detail.json`    the raw per-officer detail
 *
 * Every artifact is written once and reused on a later run, so an interrupted
 * scrape resumes instead of re-fetching. Returns the agency matches so the
 * caller can reconcile the identity ledger.
 */
export async function collectSources({
  sourceDir,
  agencyFilters,
  fetchAgencyCsv,
  client,
  logger = silentLogger,
}: CollectDeps): Promise<{ agencyMatches: AgencyMatchResult[] }> {
  const agenciesDir = path.join(sourceDir, "agencies");
  const officersDir = path.join(sourceDir, "officers");
  await mkdir(agenciesDir, { recursive: true });
  await mkdir(officersDir, { recursive: true });

  const csvPath = path.join(agenciesDir, "agencies.csv");
  let csvBody = await readTextIfExists(csvPath);
  if (csvBody === null) {
    const csv = await fetchAgencyCsv();
    csvBody = csv.body;
    await writeFile(csvPath, csv.body);
    await writeJson(path.join(agenciesDir, "citation.json"), csv.citation);
  }

  const agencyNames = mergeSupplementalAgencyNames(
    parseAgencyNames(csvBody),
    agencyFilters.supplementalAgencies,
  );
  logger.info(`mn-post: ${agencyNames.length} agencies to search`);

  const agencyMatches: AgencyMatchResult[] = [];
  for (const agencyName of agencyNames) {
    const matchPath = path.join(
      agenciesDir,
      `${artifactStem(agencyName)}.matches.json`,
    );
    let matchResult = await readJsonIfExists<AgencyMatchResult>(matchPath);
    if (matchResult === null) {
      matchResult = await client.searchAgency(agencyName);
      await writeJson(matchPath, matchResult);
    }
    agencyMatches.push(
      applyEmptyOfficerListAllowance(agencyName, matchResult, agencyFilters),
    );
  }

  const failures = findAgencyMatchFailures(agencyMatches);
  if (failures.length > 0) {
    throw new Error(
      `mn-post agency search did not resolve to exactly one match: ${failures
        .map((f) => `${f.agencyName} (${f.matchCount})`)
        .join(", ")}`,
    );
  }

  for (const matchResult of agencyMatches) {
    const rosterPath = path.join(
      officersDir,
      `${artifactStem(matchResult.agencyName)}.roster.json`,
    );
    let roster = await readJsonIfExists<OfficerRow[]>(rosterPath);
    if (roster === null) {
      roster = matchResult.allowEmptyAgencySearch
        ? []
        : await client.fetchOfficerList(matchResult.matches[0]);
      await writeJson(rosterPath, roster);
    }
    logger.info(
      `mn-post: ${matchResult.agencyName} — ${roster.length} officers`,
    );

    for (const officer of roster) {
      const licenseId = asNonEmptyString(officer.licenseId);
      if (licenseId === null) {
        throw new Error(
          `mn-post officer on ${matchResult.agencyName} roster is missing a licenseId`,
        );
      }
      const detailPath = path.join(
        officersDir,
        `${artifactStem(licenseId)}.detail.json`,
      );
      if ((await readTextIfExists(detailPath)) === null) {
        await writeJson(detailPath, await client.fetchOfficerDetail(officer));
      }
    }
  }

  return { agencyMatches };
}

function applyEmptyOfficerListAllowance(
  agencyName: string,
  matchResult: AgencyMatchResult,
  agencyFilters: AgencyFilters,
): AgencyMatchResult {
  if (
    matchResult.matches.length !== 0 ||
    !agencyFilters.allowEmptyAgencySearch.includes(agencyName)
  ) {
    return matchResult;
  }
  return { ...matchResult, allowEmptyAgencySearch: true };
}

export function findAgencyMatchFailures(
  agencyMatches: readonly AgencyMatchResult[],
): Array<{ agencyName: string; matchCount: number }> {
  return agencyMatches
    .filter(
      (result) =>
        result.matches.length !== 1 && result.allowEmptyAgencySearch !== true,
    )
    .map((result) => ({
      agencyName: result.agencyName,
      matchCount: result.matches.length,
    }));
}

function mergeSupplementalAgencyNames(
  agencyNames: string[],
  supplementalAgencies: AgencyFilters["supplementalAgencies"],
): string[] {
  const seen = new Set(agencyNames);
  return [
    ...agencyNames,
    ...supplementalAgencies
      .map((agency) => agency.agencyName)
      .filter((name) => !seen.has(name)),
  ];
}

/** Agency names from the raw CSV's `Agency`/`Agency Name` column. */
export function parseAgencyNames(csv: string): string[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const header = rows[0];
  const nameIndex = header.findIndex((column) =>
    ["agency name", "agency"].includes(column.trim().toLowerCase()),
  );
  if (nameIndex === -1) {
    throw new Error("mn-post agency CSV is missing an Agency Name column");
  }
  return rows
    .slice(1)
    .map((values) => values[nameIndex]?.trim())
    .filter((name): name is string => !!name);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  const text = await readTextIfExists(filePath);
  return text === null ? null : (JSON.parse(text) as T);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/** A stable, filesystem-safe artifact name: slug + a short content hash. */
function artifactStem(value: string): string {
  const slug =
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "source";
  const hash = crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 12);
  return `${slug}-${hash}`;
}

/** Minimal RFC-4180 CSV parser (handles quoted fields and embedded commas). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      record.push(field);
      field = "";
      if (record.some((value) => value !== "")) rows.push(record);
      record = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    if (record.some((value) => value !== "")) rows.push(record);
  }
  return rows;
}
