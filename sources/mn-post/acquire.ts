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
  openAgencyIdCache,
  writeAgencyIds,
} from "./acquire/agency-id-cache.js";
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
  const filters = await loadAgencyFilters();

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
    const cache = await openAgencyIdCache({
      statePath: state,
      searchAgency: (agencyName) => client.searchAgency(agencyName),
      allowEmptyAgencySearch: filters.allowEmptyAgencySearch,
      now: new Date().toISOString(),
    });
    const { skippedAgencies, skippedOfficers } = await collectSources({
      sourceDir,
      supplementalAgencyNames: filters.supplementalAgencies.map(
        (agency) => agency.agencyName,
      ),
      fetchAgencyCsv: () =>
        fetchPostAgencyCsv({ context, captchaWaitMs, logger: log }),
      cache,
      client,
      logger: log,
    });
    await writeSkipReport(sourceDir, skippedAgencies, skippedOfficers, log);
    await writeAgencyIds(sourceDir, cache.entries());
  } finally {
    await context.close();
  }
};
