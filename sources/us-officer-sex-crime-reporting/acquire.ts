import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "node-html-parser";
import type { SourceAcquire } from "../../src/cli/transform/source-transform.js";
import { exportUrl, readSpreadsheet, spreadsheetUrl } from "./spreadsheet.js";

export const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export type Article = {
  url: string;
  retrievedAt: string;
  status: number | null;
  finalUrl: string | null;
  bodyFile: string | null;
  sha256: string | null;
  textFile: string | null;
  title: string | null;
  error: string | null;
};

export function articleText(body: Buffer): {
  title: string | null;
  text: string;
} {
  const root = parse(body.toString("utf8"));
  const title = root.querySelector("title")?.textContent.trim() || null;
  root
    .querySelectorAll("script,style,noscript,nav,footer,header")
    .forEach((node) => node.remove());
  const text = root.structuredText.replace(/\s+/g, " ").trim();
  return { title, text };
}

export async function acquireArticles(
  urls: string[],
  dir: string,
  request: (url: string) => Promise<Response> = (url) =>
    fetch(url, { signal: AbortSignal.timeout(20_000) }),
  log: (message: string) => void = () => {},
): Promise<Article[]> {
  await mkdir(path.join(dir, "articles"), { recursive: true });
  const results: Article[] = [];
  // Bound simultaneous requests; persist each result before the next batch.
  for (let offset = 0; offset < urls.length; offset += 6) {
    const batch = await Promise.all(
      urls.slice(offset, offset + 6).map(async (url): Promise<Article> => {
        const id = digest(url);
        const result: Article = {
          url,
          retrievedAt: new Date().toISOString(),
          status: null,
          finalUrl: null,
          bodyFile: null,
          sha256: null,
          textFile: null,
          title: null,
          error: null,
        };
        let response: Response;
        let body: Buffer;
        try {
          response = await request(url);
          body = Buffer.from(await response.arrayBuffer());
        } catch (error) {
          result.error = String(error);
          await writeFile(
            path.join(dir, "articles", `${id}.json`),
            JSON.stringify(result, null, 2),
          );
          return result;
        }
        result.status = response.status;
        result.finalUrl = response.url || url;
        result.bodyFile = `articles/${id}.html`;
        result.sha256 = digest(body);
        await writeFile(path.join(dir, result.bodyFile), body);
        if (!response.ok) result.error = `HTTP ${response.status}`;
        else {
          const { title, text } = articleText(body);
          result.title = title;
          result.textFile = `articles/${id}.txt`;
          await writeFile(path.join(dir, result.textFile), text);
        }
        await writeFile(
          path.join(dir, "articles", `${id}.json`),
          JSON.stringify(result, null, 2),
        );
        return result;
      }),
    );
    results.push(...batch);
    log(
      `Retrieved ${results.length}/${urls.length} articles; ${results.filter((r) => r.error !== null).length} unavailable`,
    );
  }
  return results;
}

export const acquire: SourceAcquire = async ({ sourceDir, logger }) => {
  await mkdir(sourceDir, { recursive: true });
  const response = await fetch(exportUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Spreadsheet download: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const file = path.join(sourceDir, "source.xlsx");
  await writeFile(file, bytes);
  const rows = await readSpreadsheet(file);
  await writeFile(
    path.join(sourceDir, "spreadsheet.json"),
    JSON.stringify(
      {
        url: spreadsheetUrl,
        exportUrl,
        retrievedAt: new Date().toISOString(),
        sha256: digest(bytes),
        rows,
      },
      null,
      2,
    ),
  );
  const articles = await acquireArticles(
    [...new Set(rows.map((r) => r.url))],
    sourceDir,
    undefined,
    (message) => logger?.info(message),
  );
  await writeFile(
    path.join(sourceDir, "articles.json"),
    JSON.stringify(articles, null, 2),
  );
  for (const name of ["reviewed.json", "review-notes.json"]) {
    await writeFile(
      path.join(sourceDir, name),
      await readFile(new URL(`./${name}`, import.meta.url)),
    );
  }
};
