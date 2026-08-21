import type { AgencyCsv, CollectLogger } from "./collect.js";

const STATISTICS_URL =
  "https://mn.gov/post/boardscommittees/reportsstatistics/statistics/";
const CSV_LINK_LABEL = "MN Law Enforcement Agencies and Contact Information";

const silentLogger: CollectLogger = { info() {} };

/**
 * Download the raw agency CSV from the MN POST statistics page. The page is
 * bot-protected, so a headless browser renders it (Playwright, imported
 * dynamically); a bot-challenge response is a fail-loud error, never written as
 * if it were data.
 */
export async function fetchPostAgencyCsv({
  executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  logger = silentLogger,
}: {
  executablePath?: string;
  logger?: CollectLogger;
} = {}): Promise<AgencyCsv> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage();
    await page.goto(STATISTICS_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page
      .waitForLoadState("networkidle", { timeout: 10_000 })
      .catch(() => {});

    const pageHtml = await page.content();
    assertNotBotChallenge(pageHtml, "POST statistics page");
    const csvUrl = findAgencyCsvUrl(pageHtml);
    logger.info(`mn-post: downloading agency CSV from ${csvUrl}`);

    const response = await page.request.get(csvUrl);
    if (!response.ok()) {
      throw new Error(`Failed to fetch POST agency CSV: ${response.status()}`);
    }
    const body = await response.text();
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
    await browser.close();
  }
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

function assertNotBotChallenge(html: string, label: string): void {
  if (
    /Radware Bot Manager Captcha/i.test(html) ||
    /Please solve this CAPTCHA/i.test(html)
  ) {
    throw new Error(
      `${label} returned a bot-protection CAPTCHA instead of source data`,
    );
  }
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function normalizeText(text: string): string {
  return text
    .replace(/[\u200b-\u200d\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
