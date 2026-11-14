import { expect, it } from "vitest";
import { parse } from "node-html-parser";
import {
  publishDestinations,
  publishPage,
  type PublicationBatch,
  type Roster,
} from "../../../sources/google.news/publication.js";
import type { ReleaseArticle } from "../../../sources/lib/news.js";
import type { NewsStorage } from "../../../sources/google.news/storage.js";

const release = "prod-11111111-1111-4111-8111-111111111111";
const path = "/personnel/one/";
const agency = "/area/police/";
const roster: Roster = {
  agencies: [{ id: "a", name: "Department", path: agency }],
  personnel: [{ id: "p", name: "Officer One", path }],
  assignments: [{ id: "r", agencyId: "a", personnelId: "p" }],
};
const original =
  '<!doctype html><html><head><title>Original</title></head><body><p id="notice">Old</p><section hidden data-page-part="news"><ul data-news-list></ul><template data-template="coverage-item"><li><a data-news-title></a><p data-news-publisher></p><p data-news-date><time></time></p><p data-news-summary></p><p data-news-notes></p><p data-news-officers></p></li></template></section></body></html>';
const baseline = {
  news: {
    target: "[data-page-part=news]",
    template: { fromOriginal: "template[data-template=coverage-item]" },
    data: { articles: [] },
  },
};
function article(id: string): ReleaseArticle {
  const url = "https://example.org/" + id;
  return {
    namespace: "google.news",
    sourceId: id,
    preferredUrl: url,
    normalizedUrl: url,
    occurrences: {
      [url]: {
        url,
        title: "<b>" + id + "</b>",
        publishedAt: "2026-11-10",
        sourceName: "News",
        summary: "A <script>.",
        body: "private story body",
      },
    },
    relationships: [
      {
        namespace: "google.news",
        sourceId: "rel-" + id,
        agencyPersonnelId: "r",
        confidence: "documented",
        notes: "private note",
        occurrenceUrl: url,
      },
    ],
  };
}
function memory() {
  let version = 0;
  const records = new Map<string, { value: unknown; etag: string }>();
  const pages = new Map<string, { html: string; etag: string }>();
  const visible: string[] = [];
  for (const p of [path, agency, "/"])
    records.set("builds/" + release + "/data" + p + "index.json", {
      value: baseline,
      etag: "base",
    });
  records.set("builds/" + release + "/data/dynamic.json", {
    value: roster,
    etag: "roster",
  });
  const storage: NewsStorage = {
    async readJson<T>(key: string) {
      return structuredClone(records.get(key) ?? null) as {
        value: T;
        etag: string;
      } | null;
    },
    async writeJson(key, value, previous) {
      if ((records.get(key)?.etag ?? null) !== previous) return false;
      records.set(key, {
        value: structuredClone(value),
        etag: String(++version),
      });
      return true;
    },
    async readOriginal(id) {
      expect(id).toBe(release);
      return original;
    },
    async readOverrideEtag(_id, p) {
      return pages.get(p)?.etag ?? null;
    },
    async writeOverride(_id, p, html, previous) {
      if ((pages.get(p)?.etag ?? null) !== previous) return false;
      pages.set(p, { html, etag: String(++version) });
      return true;
    },
    async makeVisible(id, p) {
      expect(id).toBe(release);
      visible.push(p);
    },
  };
  return { storage, pages, records, visible };
}
it("regenerates all saved parts from the original, including escaped news and assignment identity", async () => {
  const { storage, pages } = memory();
  await publishPage(storage, release, path, roster, {
    articles: [article("one")],
  });
  const patch = {
    notice: {
      target: "#notice",
      template: { html: '<span data-part-text="message"></span>' },
      data: { message: "Updated & retained" },
    },
  };
  await publishPage(storage, release, path, roster, { parts: patch });
  const html = pages.get(path)!.html;
  const doc = parse(html);
  expect(doc.querySelector("title")!.text).toBe("Original");
  expect(doc.querySelector("#notice")!.text).toBe("Updated & retained");
  expect(doc.querySelector("[data-page-part]")!.hasAttribute("hidden")).toBe(
    false,
  );
  const item = doc.querySelector("ul li")!;
  expect(item.getAttribute("data-source-id")).toBe("one");
  expect(item.getAttribute("data-source-namespace")).toBe("google.news");
  expect(item.querySelector("[data-news-title]")!.text).toBe("<b>one</b>");
  expect(item.querySelector("b,script")).toBeNull();
  expect(
    item
      .querySelector("[data-news-officers] a")!
      .getAttribute("data-source-id"),
  ).toBe("rel-one");
  expect(html).not.toMatch(/private (story body|note)/);
});
it("retries from saved data when an older HTML write finishes after a newer writer", async () => {
  const { storage, pages } = memory();
  const write = storage.writeOverride.bind(storage);
  let enter!: () => void, releaseGate!: () => void;
  const entered = new Promise<void>((r) => (enter = r)),
    gate = new Promise<void>((r) => (releaseGate = r));
  let first = true;
  storage.writeOverride = async (...args) => {
    if (first) {
      first = false;
      enter();
      await gate;
    }
    return write(...args);
  };
  const slow = publishPage(storage, release, path, roster, {
    articles: [article("a")],
  });
  await entered;
  await publishPage(storage, release, path, roster, {
    articles: [article("b")],
  });
  releaseGate();
  await slow;
  expect(
    parse(pages.get(path)!.html)
      .querySelectorAll("ul li")
      .map((e) => e.getAttribute("data-source-id"))
      .sort(),
  ).toEqual(["a", "b"]);
});
it("on a fresh runner replays every pinned destination after an agency visibility failure", async () => {
  const { storage, pages, visible, records } = memory();
  const real = storage.makeVisible;
  const batch: PublicationBatch = {
    releaseId: release,
    destinations: [path, agency].map((path) => ({
      path,
      update: { articles: [article("a")] },
    })),
  };
  storage.makeVisible = async (id, p) => {
    if (p === agency) throw new Error("cache unavailable");
    await real(id, p);
  };
  await expect(
    publishDestinations(storage, "search/position-0", batch, roster),
  ).rejects.toThrow("cache unavailable");
  expect(visible).toEqual([path]);
  const first = (
    records.get("search/position-0")!.value as {
      visible: Record<string, string>;
    }
  ).visible[path];
  expect(new Date(first).toISOString()).toBe(first);
  const newRunner = { ...storage, makeVisible: real };
  const timestamps = await publishDestinations(
    newRunner,
    "search/position-0",
    { releaseId: "prod-new", destinations: [] },
    { agencies: [], personnel: [], assignments: [] },
  );
  expect(timestamps[path]).toBe(first);
  expect(visible).toEqual([path, path, agency]);
  expect([...pages.keys()]).toEqual([path, agency]);
  expect(JSON.stringify(records.get("search/position-0")?.value)).toContain(
    "rel-a",
  );
});
it("keeps the evidence-bearing copy on each profile and ranks homepage stories using their preferred source", async () => {
  const { storage, pages } = memory();
  const otherPath = "/personnel/two/";
  const rosterTwo: Roster = {
    ...roster,
    personnel: [
      ...roster.personnel,
      { id: "p2", name: "Officer Two", path: otherPath },
    ],
    assignments: [
      ...roster.assignments,
      { id: "r2", agencyId: "a", personnelId: "p2" },
    ],
  };
  const source = article("wire");
  const copy = "https://example.org/copy";
  source.occurrences[copy] = {
    ...source.occurrences[source.preferredUrl],
    url: copy,
    title: "Only source for One",
  };
  source.relationships[0]!.occurrenceUrl = copy;
  source.relationships.push({
    ...source.relationships[0]!,
    sourceId: "rel-2",
    agencyPersonnelId: "r2",
    occurrenceUrl: source.preferredUrl,
  });
  const another = article("two");
  await publishPage(storage, release, path, rosterTwo, { articles: [source] });
  await publishPage(storage, release, agency, rosterTwo, {
    articles: [source],
  });
  await publishPage(storage, release, "/", rosterTwo, {
    articles: [source, another],
    ranking: {
      windowEnd: "2026-11-11",
      placements: [
        { namespace: "google.news", sourceId: "two", position: 1, clicks: 20 },
        { namespace: "google.news", sourceId: "wire", position: 2, clicks: 8 },
      ],
    },
  });
  const links = (p: string) =>
    parse(pages.get(p)!.html)
      .querySelectorAll("ul [data-news-title]")
      .map((a) => a.getAttribute("href"));
  expect(links(path)).toEqual([copy]);
  expect(links(agency)).toEqual([source.preferredUrl]);
  expect(links("/")).toEqual([another.preferredUrl, source.preferredUrl]);
  const better = "https://example.org/original";
  const updated: ReleaseArticle = {
    ...source,
    preferredUrl: better,
    normalizedUrl: better,
    occurrences: {
      ...source.occurrences,
      [better]: {
        ...source.occurrences[source.preferredUrl]!,
        url: better,
        domainRank: 1,
      },
    },
    relationships: source.relationships.map((r) => ({
      ...r,
      occurrenceUrl: better,
    })),
  };
  await publishPage(storage, release, agency, rosterTwo, {
    articles: [updated],
  });
  expect(links(agency)).toEqual([better]);
  expect(
    parse(pages.get(agency)!.html)
      .querySelectorAll("ul [data-news-officers] a")
      .map((a) => a.getAttribute("data-source-id")),
  ).toEqual(["rel-wire", "rel-2"]);
});
it("a resumed batch regenerates updated parts without reverting a later saved edit", async () => {
  const { storage, pages } = memory();
  const part = (message: string) => ({
    notice: {
      target: "#notice",
      template: { html: '<span data-part-text="message"></span>' },
      data: { message },
    },
  });
  const batch = (message: string) => ({
    releaseId: release,
    destinations: [{ path, update: { parts: part(message) } }],
  });
  const visible = storage.makeVisible;
  storage.makeVisible = async () => {
    throw new Error("interrupted after data and HTML write");
  };
  await expect(
    publishDestinations(storage, "first", batch("First"), roster),
  ).rejects.toThrow("interrupted");
  storage.makeVisible = visible;
  await publishDestinations(storage, "second", batch("Second"), roster);
  await publishDestinations(storage, "first", batch("First"), roster);
  expect(parse(pages.get(path)!.html).querySelector("#notice")!.text).toBe(
    "Second",
  );
});
it("selects the cited evidence-bearing copy ahead of a higher-ranked reprint and preserves the newest observation", async () => {
  const { storage, pages } = memory();
  const r2 = { ...roster.assignments[0], id: "r2" };
  const persons = { ...roster, assignments: [...roster.assignments, r2] };
  const story = article("story"),
    first = "https://a.example/copy",
    second = "https://b.example/cited";
  const metadata = story.occurrences[story.preferredUrl];
  story.occurrences[first] = {
    ...metadata,
    url: first,
    domainRank: 1,
    publisherAttribution: second,
    support: [{ assignmentId: "r", paragraphHashes: ["p"] }],
  };
  story.occurrences[second] = {
    ...metadata,
    url: second,
    domainRank: 100,
    observedAt: "2026-11-14T12:00:00Z",
    support: [{ assignmentId: "r2", paragraphHashes: ["p"] }],
    title: "Fresh correction",
  };
  story.relationships[0].occurrenceUrl = first;
  story.relationships.push({
    ...story.relationships[0],
    sourceId: "r2",
    agencyPersonnelId: "r2",
    occurrenceUrl: second,
  });
  await publishPage(storage, release, agency, persons, { articles: [story] });
  const selected = () =>
    parse(pages.get(agency)!.html).querySelector("ul [data-news-title]")!;
  expect(selected().getAttribute("href")).toBe(second);
  const old = structuredClone(story);
  old.occurrences[second].observedAt = "2026-11-12T12:00:00Z";
  old.occurrences[second].title = "Stale summary";
  await publishPage(storage, release, agency, persons, { articles: [old] });
  expect(selected().text).toBe("Fresh correction");
});
