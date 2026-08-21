import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createId } from "@paralleldrive/cuid2";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { AgencyMatchResult } from "./collect.js";

export type AgencyLedgerEntry = { id: string; firstSeenAt?: string };
export type AgencyLedger = Record<string, AgencyLedgerEntry>;

/** The durable agency-identity ledger: `<statePath>/agencies.yaml`. */
export async function loadAgencyLedger(
  statePath: string,
): Promise<AgencyLedger> {
  try {
    const content = await readFile(
      path.join(statePath, "agencies.yaml"),
      "utf8",
    );
    return (parseYaml(content) as AgencyLedger | null) ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/**
 * Reconcile the ledger with this run's agency search results and persist it.
 *
 * A known agency keeps its stored id untouched — we never re-derive identity for
 * an agency we've already seen, so a changed Salesforce id can't break the run
 * (there is no "id changed" guard). A new agency is minted from its Salesforce
 * id, or a fresh cuid when the search is allowed to be empty. A new agency with
 * neither is a fail-loud error.
 */
export async function updateAgencyLedger({
  statePath,
  agencyMatches,
  now,
  createAgencyId = createId,
}: {
  statePath: string;
  agencyMatches: readonly AgencyMatchResult[];
  now: string;
  createAgencyId?: () => string;
}): Promise<AgencyLedger> {
  await mkdir(statePath, { recursive: true });
  const ledger: AgencyLedger = { ...(await loadAgencyLedger(statePath)) };

  for (const agencyMatch of agencyMatches) {
    if (ledger[agencyMatch.agencyName] !== undefined) {
      continue;
    }
    const sourceId = agencyMatch.matches[0]?.Id;
    if (sourceId === undefined && agencyMatch.allowEmptyAgencySearch !== true) {
      throw new Error(
        `${agencyMatch.agencyName} missing POST agency source id`,
      );
    }
    ledger[agencyMatch.agencyName] = {
      id: sourceId ?? createAgencyId(),
      firstSeenAt: now,
    };
  }

  await writeFile(path.join(statePath, "agencies.yaml"), stringifyYaml(ledger));
  return ledger;
}

/** Write the produce-facing `agency-ids.yaml` (name → id) into the source dir. */
export async function writeSourceAgencyIds(
  sourceDir: string,
  ledger: AgencyLedger,
): Promise<void> {
  await writeFile(
    path.join(sourceDir, "agency-ids.yaml"),
    stringifyYaml(ledger),
  );
}
