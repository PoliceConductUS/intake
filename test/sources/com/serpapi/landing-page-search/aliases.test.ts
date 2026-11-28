import { expect, it } from "vitest";
import {
  resolveNewsAliases,
  saveNewsAliases,
} from "../../../../../sources/com/serpapi/landing-page-search/aliases.js";
import type { NewsStorage } from "../../../../../sources/com/serpapi/landing-page-search/storage.js";
import type { ReleaseArticle } from "../../../../../sources/lib/news.js";
const a = "https://publisher.example/a",
  b = "https://copy.example/b",
  c = "https://copy.example/c";
it("resolves each publisher URL through CoverageLink aliases and rejects cycles or non-normalized IDs", () => {
  expect(resolveNewsAliases({ [c]: b, [b]: a })).toEqual({ [c]: a, [b]: a });
  expect(() => resolveNewsAliases({ [a]: b, [b]: a })).toThrow(/cycle/i);
  expect(() => resolveNewsAliases({ [b]: a + "?utm_source=wire" })).toThrow(
    /normalized/i,
  );
});
it("retries from the latest release aliases and preserves other record kinds", async () => {
  let value = {
    CoverageLink: {} as Record<string, string>,
    Personnel: { [b]: c },
  };
  let version = 1;
  const unexpected = async () => {
    throw Error("Unexpected page operation");
  };
  const store: NewsStorage = {
    readOriginal: unexpected,
    readOverrideEtag: unexpected,
    writeOverride: unexpected,
    makeVisible: unexpected,
    readJson: async <T>() => ({
      value: structuredClone(value) as T,
      etag: String(version),
    }),
    writeJson: async (key: string, next: unknown, etag: string | null) => {
      expect(key).toBe("builds/prod/data/alias.json");
      if (version === 1) {
        value.CoverageLink[c] = b;
        version++;
        return false;
      }
      expect(etag).toBe("2");
      value = next as typeof value;
      return true;
    },
  };
  const occurrences = Object.fromEntries(
    [a, b].map((url) => [
      url,
      { namespace: "com/serpapi/landing-page-search", sourceId: url, url },
    ]),
  );
  const story = {
    namespace: "com/serpapi/landing-page-search",
    sourceId: a,
    occurrences,
  } as ReleaseArticle;
  await saveNewsAliases(store, "prod", [story]);
  expect(resolveNewsAliases(value.CoverageLink)).toEqual({ [c]: a, [b]: a });
  expect(value.Personnel).toEqual({ [b]: c });
});
