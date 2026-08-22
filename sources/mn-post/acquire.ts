import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/run/source-run.js";
import { collectSources, type AgencyFilters } from "./acquire/collect.js";
import { fetchPostAgencyCsv } from "./acquire/agency-csv.js";
import { createPostLicenseSearchClient } from "./acquire/post-client.js";
import {
  loadAgencyLedger,
  updateAgencyLedger,
  writeSourceAgencyIds,
} from "./acquire/ledger.js";
import { writeSkipReport } from "./acquire/skip-report.js";

const FILTERS_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "acquire",
  "agency-filters.yaml",
);

async function loadAgencyFilters(): Promise<AgencyFilters> {
  const config =
    (parseYaml(
      await readFile(FILTERS_PATH, "utf8"),
    ) as Partial<AgencyFilters>) ?? {};
  return {
    allowEmptyAgencySearch: config.allowEmptyAgencySearch ?? [],
    supplementalAgencies: config.supplementalAgencies ?? [],
  };
}

/**
 * MN POST — scrape the POST License Search site into raw source files. Downloads
 * the agency CSV, searches each agency, and fetches every officer's roster and
 * detail, writing them verbatim (csv/json, no transform) for the deterministic
 * `run` phase. Reconciles the durable agency-identity ledger (a known agency
 * keeps its stored id — see updateAgencyLedger).
 *
 * The whole site is bot-protected, so everything runs in one headed Chrome with
 * a persistent profile (under the source state dir): a human solves the CAPTCHA
 * once, and that verified session is shared by the CSV page and the Salesforce
 * Aura calls and reused on later runs.
 */
export const acquire: SourceAcquire = async ({
  sourceDir,
  state,
  env,
  logger,
}: AcquireDeps) => {
  const log = logger ?? { info() {} };
  const captchaWaitMs = env.MN_POST_CAPTCHA_WAIT_MS
    ? Number(env.MN_POST_CAPTCHA_WAIT_MS)
    : undefined;
  const agencyFilters = await loadAgencyFilters();

  // The cached ledger: agency ids resolved on earlier runs. A cached id is
  // trusted over the (unreliable) live search, and lets an agency the site can't
  // resolve by name — pin its id here once — be scraped anyway.
  const cachedLedger = await loadAgencyLedger(state);
  const knownAgencyIds = new Map(
    Object.entries(cachedLedger)
      .filter(([, entry]) => typeof entry?.id === "string" && entry.id !== "")
      .map(([name, entry]) => [name, entry.id]),
  );

  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(
    path.join(state, "browser-profile"),
    {
      headless: env.MN_POST_HEADLESS === "true",
      executablePath: env.CHROME_EXECUTABLE_PATH,
      acceptDownloads: true,
    },
  );
  try {
    const client = await createPostLicenseSearchClient({
      context,
      logger: log,
    });
    const { agencyMatches, skippedAgencies, skippedOfficers } =
      await collectSources({
        sourceDir,
        agencyFilters,
        fetchAgencyCsv: () =>
          fetchPostAgencyCsv({ context, captchaWaitMs, logger: log }),
        client,
        knownAgencyIds,
        logger: log,
      });
    await writeSkipReport(sourceDir, skippedAgencies, skippedOfficers, log);
    const ledger = await updateAgencyLedger({
      statePath: state,
      agencyMatches,
      now: new Date().toISOString(),
    });
    await writeSourceAgencyIds(sourceDir, ledger);
  } finally {
    await context.close();
  }
};
