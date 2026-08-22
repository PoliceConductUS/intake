import { writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type {
  CollectLogger,
  SkippedAgency,
  SkippedOfficer,
} from "./collect.js";

/**
 * Write (and log) the acquire skip report: the agencies the site could not
 * resolve and the officers that could not be fetched. Always written so
 * `skipped.yaml` truthfully reflects the latest run — an empty report means
 * nothing was skipped.
 */
export async function writeSkipReport(
  sourceDir: string,
  skippedAgencies: readonly SkippedAgency[],
  skippedOfficers: readonly SkippedOfficer[],
  logger: CollectLogger,
): Promise<void> {
  await writeFile(
    path.join(sourceDir, "skipped.yaml"),
    stringifyYaml({ skippedAgencies, skippedOfficers }),
  );
  if (skippedAgencies.length === 0 && skippedOfficers.length === 0) {
    logger.info("mn-post: nothing skipped");
    return;
  }
  logger.info(
    `mn-post: skipped ${skippedAgencies.length} agenc${skippedAgencies.length === 1 ? "y" : "ies"} and ${skippedOfficers.length} officer${skippedOfficers.length === 1 ? "" : "s"} — see skipped.yaml`,
  );
}
