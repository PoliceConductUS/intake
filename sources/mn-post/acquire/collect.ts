import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import type { AgencyIdCache } from "./agency-id-cache.js";

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
  fetchOfficerList(agencyId: string): Promise<OfficerRow[]>;
  fetchOfficerDetail(officer: OfficerRow): Promise<OfficerDetail>;
};

export type CollectLogger = { info: (message: string) => void };
const silentLogger: CollectLogger = { info() {} };

export type SkippedAgency = {
  agencyName: string;
  reason: string;
  candidateCount: number;
};
export type SkippedOfficer = {
  agencyName: string;
  officer: string;
  reason: string;
};
export type CollectResult = {
  skippedAgencies: SkippedAgency[];
  skippedOfficers: SkippedOfficer[];
};

export type CollectDeps = {
  sourceDir: string;
  supplementalAgencyNames: readonly string[];
  fetchAgencyCsv: () => Promise<AgencyCsv>;
  cache: AgencyIdCache;
  client: PostClient;
  logger?: CollectLogger;
};

/**
 * Download every raw input the produce phase reads, preserving the site's own
 * format (csv stays csv, json stays json): `agencies/agencies.csv`, and per
 * agency `officers/<stem>.roster.json` and `officers/<stem>.detail.json`. Each
 * artifact is written once and reused, so an interrupted scrape resumes. An
 * agency the cache cannot resolve, or an officer with no licenseId, is skipped
 * and reported rather than aborting the scrape.
 */
export async function collectSources({
  sourceDir,
  supplementalAgencyNames,
  fetchAgencyCsv,
  cache,
  client,
  logger = silentLogger,
}: CollectDeps): Promise<CollectResult> {
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

  const agencyNames = withSupplementalNames(
    parseAgencyNames(csvBody),
    supplementalAgencyNames,
  );
  logger.info(`mn-post: ${agencyNames.length} agencies`);

  const skippedAgencies: SkippedAgency[] = [];
  const skippedOfficers: SkippedOfficer[] = [];
  for (const [index, agencyName] of agencyNames.entries()) {
    const position = `[${index + 1}/${agencyNames.length}]`;
    const lookup = await cache.resolve(agencyName);
    if (lookup.kind === "skip") {
      skippedAgencies.push({
        agencyName,
        reason: lookup.reason,
        candidateCount: lookup.candidateCount,
      });
      logger.info(
        `mn-post: ${position} skipping ${agencyName} — ${lookup.reason}`,
      );
      continue;
    }

    const rosterPath = path.join(
      officersDir,
      `${artifactStem(agencyName)}.roster.json`,
    );
    let roster = await readJsonIfExists<OfficerRow[]>(rosterPath);
    if (roster === null) {
      roster =
        lookup.kind === "empty"
          ? []
          : await client.fetchOfficerList(lookup.agencyId);
      await writeJson(rosterPath, roster);
    }
    logger.info(
      `mn-post: ${position} ${agencyName} — ${roster.length} officers`,
    );

    let processed = 0;
    let detailsFetched = 0;
    for (const officer of roster) {
      processed += 1;
      const licenseId = asNonEmptyString(officer.licenseId);
      if (licenseId === null) {
        skippedOfficers.push({
          agencyName,
          officer: describeOfficer(officer),
          reason: "roster row is missing a licenseId",
        });
      } else {
        const detailPath = path.join(
          officersDir,
          `${artifactStem(licenseId)}.detail.json`,
        );
        if ((await readTextIfExists(detailPath)) === null) {
          await writeJson(detailPath, await client.fetchOfficerDetail(officer));
          detailsFetched += 1;
        }
      }
      // Heartbeat only while actively fetching, so a resumed (cached) agency
      // stays quiet.
      if (processed % 50 === 0 && detailsFetched > 0) {
        logger.info(
          `mn-post: ${position} ${agencyName} — ${processed}/${roster.length} officers`,
        );
      }
    }
  }

  return { skippedAgencies, skippedOfficers };
}

function describeOfficer(officer: OfficerRow): string {
  return (
    asNonEmptyString(officer.name) ??
    asNonEmptyString(officer.contactId) ??
    "unknown officer"
  );
}

function withSupplementalNames(
  agencyNames: string[],
  supplementalAgencyNames: readonly string[],
): string[] {
  const seen = new Set(agencyNames);
  return [
    ...agencyNames,
    ...supplementalAgencyNames.filter((name) => !seen.has(name)),
  ];
}

export function parseAgencyNames(csv: string): string[] {
  const rows = parseCsv(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Array<Record<string, string>>;
  if (rows.length > 0 && !("Agency" in rows[0])) {
    throw new Error('mn-post agency CSV is missing the "Agency" column');
  }
  return rows.map((row) => row["Agency"]).filter((name) => Boolean(name));
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
