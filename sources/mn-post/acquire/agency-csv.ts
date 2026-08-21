import { readFile } from "node:fs/promises";
import type { AgencyCsv, CollectLogger } from "./collect.js";

const STATISTICS_URL =
  "https://mn.gov/post/boardscommittees/reportsstatistics/statistics/";
const CSV_LINK_LABEL = "MN Law Enforcement Agencies and Contact Information";
const DEFAULT_CAPTCHA_WAIT_MS = 180_000;

const silentLogger: CollectLogger = { info() {} };

export type AgencyCsvOptions = {
  /** A persistent browser-profile dir so a solved CAPTCHA carries across runs. */
  userDataDir: string;
  executablePath?: string;
  /** Headed by default so a human can solve the CAPTCHA; set true to force headless. */
  headless?: boolean;
  /** How long to wait for a manual CAPTCHA solve before failing. 0 disables the wait. */
  captchaWaitMs?: number;
  logger?: CollectLogger;
};

/**
 * Download the raw agency CSV from the MN POST statistics page. The page is
 * Radware bot-protected, so a headless browser is challenged with a CAPTCHA. We
 * open a real (headed) browser with a persistent profile; when the page shows a
 * CAPTCHA we pause for a human to solve it, then reuse that session on later
 * runs. A bot-challenge response is never written as if it were data.
 */
export async function fetchPostAgencyCsv({
  userDataDir,
  executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless = false,
  captchaWaitMs = DEFAULT_CAPTCHA_WAIT_MS,
  logger = silentLogger,
}: AgencyCsvOptions): Promise<AgencyCsv> {
  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    executablePath,
    acceptDownloads: true,
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
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
    await context.close();
  }
}

/** Click the labelled CSV link and read its body, whether it downloads or renders. */
async function clickAndReadCsv(
  page: import("playwright").Page,
  csvUrl: string,
): Promise<string> {
  const link = await findAgencyCsvLinkHandle(page, csvUrl);
  if (!link) {
    throw new Error(
      `POST statistics page did not contain the "${CSV_LINK_LABEL}" link`,
    );
  }
  const responsePromise = page
    .waitForResponse((candidate) => candidate.url() === csvUrl, {
      timeout: 60_000,
    })
    .then((response) => ({ kind: "response" as const, response }));
  const downloadPromise = page
    .waitForEvent("download", { timeout: 60_000 })
    .then((download) => ({ kind: "download" as const, download }));

  await link.click();
  const result = await Promise.race([responsePromise, downloadPromise]);
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

async function findAgencyCsvLinkHandle(
  page: import("playwright").Page,
  csvUrl: string,
): Promise<import("playwright").ElementHandle<Element> | null> {
  const handle = await page.evaluateHandle(
    ({ csvUrl, statisticsUrl, label }) => {
      const normalize = (text: string) =>
        text
          .replace(/[\u200b-\u200d\uFEFF]/g, "")
          .replace(/\s+/g, " ")
          .trim();
      return (
        Array.from(document.querySelectorAll("a")).find((anchor) => {
          const href = anchor.getAttribute("href");
          if (!href) return false;
          return (
            new URL(href, statisticsUrl).toString() === csvUrl &&
            normalize(anchor.textContent ?? "").includes(label)
          );
        }) ?? null
      );
    },
    { csvUrl, statisticsUrl: STATISTICS_URL, label: CSV_LINK_LABEL },
  );
  return handle.asElement() as
    | import("playwright").ElementHandle<Element>
    | null;
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
  return value.replace(/<[^>]*>/g, "");
}

function normalizeText(text: string): string {
  return text
    .replace(/[\u200b-\u200d\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
