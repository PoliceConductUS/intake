import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createId } from "@paralleldrive/cuid2";
import { chromium } from "playwright";
import { searchGoogleNews } from "./browser.js";
import type { SourceAcquire } from "../../src/cli/transform/source-transform.js";
import {
  processNewsOccurrence,
  NewsExtractionError,
  normalizedParagraph,
  mergeCurrentNews,
  type NewsOccurrence,
  type ReleaseArticle,
} from "../lib/news.js";
import { domainRankFor } from "../lib/news-ranks.js";
import { createNewsInference } from "../lib/news-inference.js";
import { sweepNews, type SweepPosition } from "./sweep.js";
type Acquisition = {
  position?: SweepPosition;
  articles: ReleaseArticle[];
  evidence: Record<string, NewsOccurrence>;
  ambiguous: Record<string, string[]>;
  unavailable?: Record<string, string>;
};
export const acquire: SourceAcquire = async ({
  sourceDir,
  previousSourceDirs = [],
  env,
  data,
  logger,
}) => {
  const { newsAssignments, newsOfficerNames } = data;
  if (!newsAssignments || !newsOfficerNames)
    throw Error(
      "Local discovery needs the Intake agency and personnel roster.",
    );
  let saved: Acquisition = { articles: [], evidence: {}, ambiguous: {} };
  for (const dir of [sourceDir, ...previousSourceDirs]) {
    try {
      saved = JSON.parse(await readFile(join(dir, "acquisition.json"), "utf8"));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const infer = createNewsInference({
    ...env,
    NEWS_INFERENCE_URL:
      env.NEWS_INFERENCE_URL ?? "http://127.0.0.1:11434/v1/chat/completions",
    NEWS_INFERENCE_MODEL: env.NEWS_INFERENCE_MODEL ?? "qwen2.5:7b",
  });
  const ranks: Record<string, number> = env.NEWS_DOMAIN_RANKS
    ? JSON.parse(await readFile(env.NEWS_DOMAIN_RANKS, "utf8"))
    : {};
  const selectors: Record<string, string> = env.NEWS_CORRECTED_SELECTORS
    ? JSON.parse(await readFile(env.NEWS_CORRECTED_SELECTORS, "utf8"))
    : {};
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    handleSIGINT: false,
    handleSIGTERM: false,
    executablePath: env.CHROME_EXECUTABLE_PATH,
  });
  const context = await browser.newContext();
  const reader = await context.newPage();
  const page = await context.newPage();
  let stopping = false;
  const stop = () => {
    stopping = true;
    void page.close().catch(() => {});
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  async function persist() {
    await writeFile(join(sourceDir, "acquisition.tmp"), JSON.stringify(saved));
    await rename(
      join(sourceDir, "acquisition.tmp"),
      join(sourceDir, "acquisition.json"),
    );
  }
  function unavailable(url: string, reason: string) {
    (saved.unavailable ??= {})[url] = reason;
    logger?.info("Unavailable publisher " + url + ": " + reason);
    return null;
  }
  async function readOccurrence(url: string) {
    const cached = saved.evidence[url];
    const correctedSelector = selectors[url];
    if (cached && (!correctedSelector || cached.selector === correctedSelector))
      return cached;
    let response;
    try {
      response = await reader.goto(url, { waitUntil: "domcontentloaded" });
    } catch (error) {
      return unavailable(url, String(error));
    }
    if (!response?.ok())
      return unavailable(url, "HTTP " + (response?.status() ?? "no response"));
    let occurrence: NewsOccurrence;
    try {
      occurrence = await processNewsOccurrence({
        html: await reader.content(),
        url: reader.url(),
        correctedSelector,
        domainRank: domainRankFor(reader.url(), ranks),
        assignments: newsAssignments,
        infer,
      });
    } catch (error) {
      if (error instanceof NewsExtractionError)
        return unavailable(url, error.message);
      throw error;
    }
    if (saved.unavailable) delete saved.unavailable[url];
    saved.evidence[url] = occurrence;
    return occurrence;
  }
  try {
    await sweepNews(saved.position, {
      shouldStop: () => stopping,
      agencies: (cursor) => data.agencies({ cursor, limit: 1 }),
      officers: newsOfficerNames,
      search: (query, nextPage) =>
        searchGoogleNews(page, query, nextPage, (message) =>
          logger?.info(message),
        ),
      async visit(url) {
        const occurrence = await readOccurrence(url);
        if (!occurrence) return;
        const result = await mergeCurrentNews(saved.articles, occurrence, {
          now: new Date(),
          namespace: "org.policeconduct.local-news",
          mint: createId,
          summarize: async (body) => (await infer(body, [])).summary,
          read: readOccurrence,
          known: Object.values(saved.evidence),
        });
        if (result.ambiguous.length) {
          saved.ambiguous[url] = result.ambiguous;
          logger?.info("Ambiguous article: " + url);
        }
        saved.articles = result.articles;
        if (result.needsCorrection.length)
          logger?.info(
            "Review lost assignment evidence for " +
              url +
              ": " +
              result.needsCorrection.join(", "),
          );
      },
      async save(position) {
        saved.position = position;
        await persist();
      },
    });
    await persist();
    const byHash = new Map<
      string,
      { text: string; occurrences: { url: string; assignmentIds: string[] }[] }
    >();
    for (const occurrence of Object.values(saved.evidence)) {
      for (const paragraph of new Map(
        occurrence.paragraphs?.map((p) => [p.hash, p]),
      ).values()) {
        const index = byHash.get(paragraph.hash) ?? {
          text: normalizedParagraph(paragraph.text),
          occurrences: [],
        };
        index.occurrences.push({
          url: occurrence.url,
          assignmentIds: (occurrence.support ?? [])
            .filter((s) => s.paragraphHashes.includes(paragraph.hash))
            .map((s) => s.assignmentId),
        });
        byHash.set(paragraph.hash, index);
      }
    }
    for (const [hash, index] of byHash) {
      const dir = join(sourceDir, "paragraphs", hash);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "index.json"), JSON.stringify(index));
    }
    await writeFile(
      join(sourceDir, "local.news.json"),
      JSON.stringify({ articles: saved.articles }),
    );
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await browser.close();
  }
};
