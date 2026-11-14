import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { transform } from "../../../sources/org.policeconduct.release-news/transform.js";
import { newsImportContext } from "../../../src/cli/transform/news-import-context.js";
import { createSourceNameToCanonicalIdLedger } from "../../../src/cli/state/source-name-to-canonical-id/index.js";
import type { ReleaseArticle } from "../../../src/shared/release-news.js";

const a = "https://report.example/First";
const b = "https://copy.example/" + "very-long-story-".repeat(35);
const c = "https://third.example/story";
const ns = "google.news";
const article = (url: string): ReleaseArticle => ({
  namespace: ns,
  sourceId: url,
  preferredUrl: url,
  normalizedUrl: url,
  occurrences: {
    [url]: {
      url,
      namespace: ns,
      sourceId: url,
      title: "News",
      publishedAt: "2026-11-14",
      sourceName: null,
      summary: null,
    },
  },
  relationships: [],
});

async function fixture() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "import-news-aliases-"));
  const ledger = createSourceNameToCanonicalIdLedger({ rootDir });
  const news = newsImportContext(
    {
      query: async () => ({ rows: [] }),
      connect: async () => {},
      end: async () => {},
    },
    ledger,
    "org.policeconduct.release-news",
  );
  async function run(
    aliases: Record<string, string>,
    articles: ReleaseArticle[],
    placement?: string,
  ) {
    const alias = path.join(rootDir, "alias.json");
    const page = path.join(rootDir, "page.news.json");
    await writeFile(
      alias,
      JSON.stringify({ CoverageLink: aliases, Agency: { [a]: c } }),
    );
    await writeFile(
      page,
      JSON.stringify({
        articles,
        ...(placement
          ? {
              ranking: {
                windowEnd: "2026-11-14",
                placements: [
                  {
                    namespace: ns,
                    sourceId: placement,
                    position: 1,
                    clicks: 7,
                  },
                ],
              },
            }
          : {}),
      }),
    );
    return transform({ paths: [page, alias], data: { news } } as never);
  }
  return { ledger, run, rootDir };
}
it("follows link aliases before merging pages, placements, and historical single-key imports", async () => {
  const { ledger, run, rootDir } = await fixture();
  const manifest = await run({ [b]: a, [c]: b }, [article(c), article(a)], b);
  const links = manifest.artifacts.find(
    (art) => art.kind === "CoverageLinks",
  )!.records;
  expect(Object.keys(links)).toHaveLength(1);
  expect(
    Object.values(
      manifest.artifacts.find(
        (art) => art.kind === "CoverageHomepagePlacements",
      )!.records,
    )[0]?.spec,
  ).toMatchObject({ coverage_link_id: Object.keys(links)[0] });
  const id = await ledger.read(ns, "CoverageLink", a);
  expect(id).toMatch(/^[a-z][a-z0-9]{23}$/);
  for (const url of [c, b, a]) {
    await run({}, [article(url)]);
    expect(await ledger.read(ns, "CoverageLink", url)).toBe(id);
  }
  const reopened = createSourceNameToCanonicalIdLedger({ rootDir });
  const reverse = await reopened.sourceIdFor(ns, "CoverageLink", id!);
  expect(await reopened.read(ns, "CoverageLink", reverse)).toBe(id);
  expect(
    await ledger.read("another.namespace", "CoverageLink", a),
  ).toBeUndefined();
  const otherCase = a.toLowerCase();
  expect(await ledger.read(ns, "CoverageLink", otherCase)).toBeUndefined();
  const otherId = await ledger.findOrCreate(ns, "CoverageLink", otherCase);
  expect(otherId).not.toBe(id);
  expect(await reopened.read(ns, "CoverageLink", otherCase)).toBe(otherId);
  expect(await reopened.read(ns, "CoverageLink", a)).toBe(id);
});
it("preserves an ID known only by a duplicate and reserves new alias-only groups", async () => {
  const { ledger, run } = await fixture();
  const prior = await ledger.findOrCreate(ns, "CoverageLink", b);
  await run({ [b]: a, [c]: "https://new.example/story" }, []);
  expect(await ledger.read(ns, "CoverageLink", a)).toBe(prior);
  const reserved = await ledger.read(ns, "CoverageLink", c);
  expect(reserved).toBeTruthy();
  await run({}, [article(c)]);
  expect(
    await ledger.read(ns, "CoverageLink", "https://new.example/story"),
  ).toBe(reserved);
});
it("rejects conflicting mapped groups before binding an unrelated new group", async () => {
  const { ledger, run } = await fixture();
  for (const url of [a, c]) await ledger.findOrCreate(ns, "CoverageLink", url);
  await expect(
    run({ [b]: "https://else.example/story", [c]: a }, []),
  ).rejects.toThrow(/conflict/i);
  expect(
    await ledger.read(ns, "CoverageLink", "https://else.example/story"),
  ).toBeUndefined();
});
it("imports a built canonical row retaining its established opaque source ID", async () => {
  const { run } = await fixture();
  const row = article(a);
  row.canonicalId = "established-id";
  row.sourceId = "article-one";
  delete row.occurrences[a].sourceId;
  delete row.occurrences[a].namespace;
  const manifest = await run({}, [row]);
  expect(Object.values(manifest.artifacts[0]!.records)[0]).toMatchObject({
    metadata: { selector: { id: row.canonicalId } },
    spec: { source_id: "article-one" },
  });
});
