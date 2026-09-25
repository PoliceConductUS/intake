import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { AgencyMatchResult } from "./collect.js";

export type AgencyLedgerEntry = { id: string; firstSeenAt?: string };
export type AgencyLedger = Record<string, AgencyLedgerEntry>;

export type AgencyIdLookup =
  | { kind: "resolved"; agencyId: string }
  | { kind: "skip"; reason: string; candidateCount: number };

export type AgencyIdCache = {
  resolve(agencyName: string): Promise<AgencyIdLookup>;
  entries(): AgencyLedger;
};

const LEDGER_FILE = "agencies.yaml";

async function readLedger(filePath: string): Promise<AgencyLedger> {
  try {
    return (
      (parseYaml(await readFile(filePath, "utf8")) as AgencyLedger | null) ?? {}
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/**
 * A cache of agency name → Salesforce id, persisted at `<statePath>/agencies.yaml`.
 * A cached id is returned without searching; a cache miss searches the site and
 * caches an unambiguous result. An agency the site cannot resolve to exactly one
 * match is a skip. A cached id is never re-derived, so a changed Salesforce id
 * cannot break a known agency.
 */
export async function openAgencyIdCache({
  statePath,
  searchAgency,
  now,
}: {
  statePath: string;
  searchAgency: (agencyName: string) => Promise<AgencyMatchResult>;
  now: string;
}): Promise<AgencyIdCache> {
  const filePath = path.join(statePath, LEDGER_FILE);
  const ledger = await readLedger(filePath);

  async function cache(agencyName: string, id: string): Promise<void> {
    ledger[agencyName] = { id, firstSeenAt: now };
    await mkdir(statePath, { recursive: true });
    await writeFile(filePath, stringifyYaml(ledger));
  }

  return {
    async resolve(agencyName: string): Promise<AgencyIdLookup> {
      const cached = ledger[agencyName]?.id;
      if (cached) {
        return { kind: "resolved", agencyId: cached };
      }
      const { matches } = await searchAgency(agencyName);
      if (matches.length === 1) {
        await cache(agencyName, matches[0].Id);
        return { kind: "resolved", agencyId: matches[0].Id };
      }
      return {
        kind: "skip",
        reason: "site agency search returned no resolvable id",
        candidateCount: matches.length,
      };
    },
    entries: () => ledger,
  };
}

export async function writeAgencyIds(
  sourceDir: string,
  ledger: AgencyLedger,
): Promise<void> {
  await writeFile(
    path.join(sourceDir, "agency-ids.yaml"),
    stringifyYaml(ledger),
  );
}
