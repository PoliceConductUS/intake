import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { resolveNewsAliases } from "../google.news/aliases.js";
import { releaseArticleKeys } from "./article-sources.js";
import type { SourceTransform } from "../../src/cli/transform/source-transform.js";
import { transformNews } from "../lib/news-import.js";
export { produces } from "../lib/news-import.js";
export const description = "Import coverage from a selected website release.";
export const transform: SourceTransform = async ({ paths, data }) => {
  if (!data?.news)
    throw Error("DATABASE_URL is required for release news import.");
  const aliasFiles = paths.filter((file) => basename(file) === "alias.json");
  if (aliasFiles.length !== 1)
    throw Error("Expected one acquired release alias.json.");
  const file = JSON.parse(await readFile(aliasFiles[0]!, "utf8"));
  const aliases = resolveNewsAliases(file?.CoverageLink);
  const news = data.news;
  return transformNews(paths, news, undefined, (articles) =>
    releaseArticleKeys(articles, aliases, news),
  );
};
