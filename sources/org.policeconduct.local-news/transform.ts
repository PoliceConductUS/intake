import type { SourceTransform } from "../../src/cli/transform/source-transform.js";
import { transformNews } from "../lib/news-import.js";
export { produces } from "../lib/news-import.js";
export const description =
  "Coverage discovered by the local browser and inference agent.";
export const transform: SourceTransform = async ({ paths, data }) => {
  if (!data?.news || !data.canonicalAssignmentForLocalNews)
    throw Error("DATABASE_URL is required for local news import.");
  return transformNews(paths, data.news, data.canonicalAssignmentForLocalNews);
};
