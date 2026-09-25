import { readFile } from "node:fs/promises";
import type { AgencyCsv, CollectLogger } from "./collect.js";

const STATISTICS_URL =
  "https://mn.gov/post/boardscommittees/reportsstatistics/statistics/";
const CSV_LINK_LABEL = "MN Law Enforcement Agencies and Contact Information";
const DEFAULT_CAPTCHA_WAIT_MS = 180_000;

const silentLogger: CollectLogger = { info() {} };

export type AgencyCsvOptions = {
  /** The caller's headed, human-verified browser context. */
  context: import("playwright").BrowserContext;
  /** How long to wait for a manual CAPTCHA solve before failing. 0 disables the wait. */
  captchaWaitMs?: number;
  logger?: CollectLogger;
};

/**
 * Download the raw agency CSV from the MN POST statistics page. The page is
 * Radware bot-protected, so it runs in the caller's headed browser; when the
 * page shows a CAPTCHA we pause for a human to solve it (the persistent profile
 * reuses that session on later runs). A bot-challenge response is never written
 * as if it were data.
 */
export async function fetchPostAgencyCsv({
  context,
  captchaWaitMs = DEFAULT_CAPTCHA_WAIT_MS,
  logger = silentLogger,
}: AgencyCsvOptions): Promise<AgencyCsv> {
  const page = await context.newPage();
  try {
    await page.goto(STATISTICS_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page
      .waitForLoadState("networkidle", { timeout: 10_000 })
      .catch(() => {});

    if (isBotChallenge(await page.content())) {
      if (captchaWaitMs <= 0) {
        assertNotBotChallenge(await page.content(), "POST statistics page");
      }
      logger.info(
        `mn-post: CAPTCHA on the statistics page — solve it in the open browser window (waiting up to ${Math.round(captchaWaitMs / 1000)}s)`,
      );
      await waitForManualCaptchaResolution(page, captchaWaitMs);
      await page
        .waitForLoadState("networkidle", { timeout: 10_000 })
        .catch(() => {});
    }
    assertNotBotChallenge(await page.content(), "POST statistics page");

    const csvUrl = findAgencyCsvUrl(await page.content());
    logger.info(`mn-post: downloading agency CSV from ${csvUrl}`);
    // Click the link (a real in-page navigation carries the bot-challenge
    // cookies); a direct asset request is flagged as a bot.
    const body = await clickAndReadCsv(page, csvUrl);
    assertNotBotChallenge(body, "POST agency CSV");

    return {
      body,
      citation: {
        source: "Minnesota POST",
        pageUrl: STATISTICS_URL,
        url: csvUrl,
        label: CSV_LINK_LABEL,
      },
    };
  } finally {
    await page.close();
  }
}

/**
 * Click the labelled CSV link and read its body, whether the browser renders it
 * inline (a response) or downloads it. A locator is used (not an in-page script)
 * so nothing is serialized into the page.
 */
async function clickAndReadCsv(
  page: import("playwright").Page,
  csvUrl: string,
): Promise<string> {
  const link = page
    .getByRole("link", { name: new RegExp(escapeRegExp(CSV_LINK_LABEL), "i") })
    .first();
  const responsePromise = page
    .waitForResponse((candidate) => candidate.url() === csvUrl, {
      timeout: 60_000,
    })
    .then((response) => ({ kind: "response" as const, response }))
    .catch(() => null);
  const downloadPromise = page
    .waitForEvent("download", { timeout: 60_000 })
    .then((download) => ({ kind: "download" as const, download }))
    .catch(() => null);

  await link.click();
  const result = await Promise.race([responsePromise, downloadPromise]);
  if (result === null) {
    throw new Error("Timed out downloading the POST agency CSV after clicking");
  }
  if (result.kind === "download") {
    const downloadPath = await result.download.path();
    return readFile(downloadPath, "utf8");
  }
  if (!result.response.ok()) {
    throw new Error(
      `Failed to fetch POST agency CSV: ${result.response.status()}`,
    );
  }
  return result.response.text();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForManualCaptchaResolution(
  page: import("playwright").Page,
  captchaWaitMs: number,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const html = document.documentElement.outerHTML;
      return (
        !/Radware Bot Manager Captcha/i.test(html) &&
        !/Please solve this CAPTCHA/i.test(html)
      );
    },
    undefined,
    { timeout: captchaWaitMs },
  );
}

/** The CSV href behind the labelled link on the statistics page. */
export function findAgencyCsvUrl(html: string): string {
  const linkPattern = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkPattern)) {
    if (normalizeText(stripTags(match[2])).includes(CSV_LINK_LABEL)) {
      return new URL(match[1], STATISTICS_URL).toString();
    }
  }
  throw new Error(
    `POST statistics page did not contain the "${CSV_LINK_LABEL}" link`,
  );
}

function isBotChallenge(html: string): boolean {
  return (
    /Radware Bot Manager Captcha/i.test(html) ||
    /Please solve this CAPTCHA/i.test(html)
  );
}

function assertNotBotChallenge(html: string, label: string): void {
  if (isBotChallenge(html)) {
    throw new Error(
      `${label} returned a bot-protection CAPTCHA instead of source data`,
    );
  }
}

function stripTags(value: string): string {
  let current = value;
  let previous: string;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, "");
  } while (current !== previous);
  return current;
}

function normalizeText(text: string): string {
  return text
    .replace(/[\u200b-\u200d\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
