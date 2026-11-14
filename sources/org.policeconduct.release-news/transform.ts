import type { SourceTransform } from "../../src/cli/transform/source-transform.js";
import { transformNews } from "../lib/news-import.js";
export { produces } from "../lib/news-import.js";
export const description = "Import coverage from a selected website release.";
export const transform: SourceTransform = async ({ paths, data }) => {
  if (!data?.news)
    throw Error("DATABASE_URL is required for release news import.");
  return transformNews(paths, data.news);
};
