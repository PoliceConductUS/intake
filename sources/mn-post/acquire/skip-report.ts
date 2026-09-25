import { writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type {
  CollectLogger,
  SkippedAgency,
  SkippedOfficer,
} from "./collect.js";
import type { SkippedDocument } from "./collect-documents.js";

/**
 * Write (and log) the acquire skip report: the agencies the site could not
 * resolve, the officers that could not be fetched, and the disciplinary
 * documents the site no longer serves. Always written so `skipped.yaml`
 * truthfully reflects the latest run — an empty report means nothing was
 * skipped.
 */
export async function writeSkipReport(
  sourceDir: string,
  skippedAgencies: readonly SkippedAgency[],
  skippedOfficers: readonly SkippedOfficer[],
  skippedDocuments: readonly SkippedDocument[],
  logger: CollectLogger,
): Promise<void> {
  await writeFile(
    path.join(sourceDir, "skipped.yaml"),
    stringifyYaml({ skippedAgencies, skippedOfficers, skippedDocuments }),
  );
  if (
    skippedAgencies.length === 0 &&
    skippedOfficers.length === 0 &&
    skippedDocuments.length === 0
  ) {
    logger.info("mn-post: nothing skipped");
    return;
  }
  logger.info(
    `mn-post: skipped ${skippedAgencies.length} agenc${skippedAgencies.length === 1 ? "y" : "ies"}, ${skippedOfficers.length} officer${skippedOfficers.length === 1 ? "" : "s"}, and ${skippedDocuments.length} document${skippedDocuments.length === 1 ? "" : "s"} — see skipped.yaml`,
  );
}
