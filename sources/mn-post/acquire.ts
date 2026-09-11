import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/transform/source-transform.js";
import {
  collectSources,
  type AgencyFilters,
  type PostClient,
} from "./acquire/collect.js";
import { collectDocuments } from "./acquire/collect-documents.js";
import { createDocumentFetcher } from "./acquire/document-fetch.js";
import { extractDocumentText } from "./acquire/document-text.js";
import { createLazyOrderAnalyzer } from "./acquire/order-analysis.js";
import { fetchPostAgencyCsv } from "./acquire/agency-csv.js";
import {
  createPostLicenseSearchClient,
  type PostClientHandle,
} from "./acquire/post-client.js";
import {
  openAgencyIdCache,
  writeAgencyIds,
} from "./acquire/agency-id-cache.js";
import { writeSkipReport } from "./acquire/skip-report.js";
import { loadExcludedRecords } from "../../src/shared/io/index.js";

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
    supplementalAgencies: config.supplementalAgencies ?? [],
  };
}

// Excluded agencies live in state (they change without a software version): a
// kind:Agency entry in <state>/excluded.yaml, matched by name/key.
async function loadExcludedAgencyNames(statePath: string): Promise<string[]> {
  const excluded = await loadExcludedRecords(statePath);
  return [...excluded.values()]
    .filter((record) => record.kind === "Agency")
    .flatMap((record) =>
      [record.key, record.name].filter((value): value is string =>
        Boolean(value),
      ),
    );
}

// The license search is opened on first use: a resumed run whose rosters and
// details are all on disk never has to reach the (human-verified) search app.
function createLazyPostClient(
  open: () => Promise<PostClientHandle>,
): PostClient & { close(): Promise<void> } {
  let handle: Promise<PostClientHandle> | undefined;
  const client = (): Promise<PostClientHandle> => (handle ??= open());
  return {
    searchAgency: async (agencyName) =>
      (await client()).searchAgency(agencyName),
    fetchOfficerList: async (agencyId) =>
      (await client()).fetchOfficerList(agencyId),
    fetchOfficerDetails: async (officers) =>
      (await client()).fetchOfficerDetails(officers),
    close: async () => {
      if (handle !== undefined) await (await handle).close();
    },
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
  const excludedAgencyNames = await loadExcludedAgencyNames(state);

  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(
    path.join(state, "browser-profile"),
    {
      headless: env.MN_POST_HEADLESS === "true",
      executablePath: env.CHROME_EXECUTABLE_PATH,
      acceptDownloads: true,
    },
  );
  const client = createLazyPostClient(() =>
    createPostLicenseSearchClient({ context, logger: log }),
  );
  try {
    const cache = await openAgencyIdCache({
      statePath: state,
      searchAgency: (agencyName) => client.searchAgency(agencyName),
      now: new Date().toISOString(),
    });
    const { skippedAgencies, skippedOfficers } = await collectSources({
      sourceDir,
      supplementalAgencyNames: filters.supplementalAgencies.map(
        (agency) => agency.agencyName,
      ),
      excludedAgencyNames,
      fetchAgencyCsv: () =>
        fetchPostAgencyCsv({ context, captchaWaitMs, logger: log }),
      cache,
      client,
      logger: log,
    });
    const { skippedDocuments } = await collectDocuments({
      sourceDir,
      statePath: state,
      fetchDocument: createDocumentFetcher({ context, logger: log }),
      extractText: extractDocumentText,
      analyzer: createLazyOrderAnalyzer(env.ANTHROPIC_API_KEY),
      now: () => new Date().toISOString(),
      logger: log,
    });
    await writeSkipReport(
      sourceDir,
      skippedAgencies,
      skippedOfficers,
      skippedDocuments,
      log,
    );
    await writeAgencyIds(sourceDir, cache.entries());
  } finally {
    await client.close();
    await context.close();
  }
};
