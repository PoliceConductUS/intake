import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createId } from "@paralleldrive/cuid2";
import {
  collectTraffic,
  homepageRanking,
  pairKey,
  searchFirst,
  shiftDate,
  type Match,
  type Traffic,
} from "./discovery.js";
import {
  newsResults,
  ProviderAllowance,
  required,
  searchConsole,
} from "./providers.js";
import { readArticle } from "./article-http.js";
import {
  chicagoDate,
  eligibleNewsDate,
  mergeCurrentNews,
  normalizedParagraph,
  processNewsOccurrence,
  type ReleaseArticle,
  type NewsOccurrence,
} from "../lib/news.js";
import { domainRankFor } from "../lib/news-ranks.js";
import { createNewsInference } from "../lib/news-inference.js";
import { createNewsStorage } from "./storage.js";
import { publishDestinations, type PublicationBatch } from "./publication.js";

type Person = {
  id: string;
  name: string;
  path: string | null;
  firstName?: string;
  lastName?: string | null;
  displayName?: string;
};
type Roster = {
  personnel: Person[];
  agencies: Person[];
  assignments: { id: string; agencyId: string; personnelId: string }[];
  coveragePaths: string[];
};
type Window = { startDate: string; endDate: string };
type Observation = {
  startDate: string;
  endDate: string;
  position: number | null;
};
type State = {
  releaseId: string;
  articles: ReleaseArticle[];
  matches: Match[];
  queue?: {
    runId: string;
    window: Window;
    pairs: Traffic[];
    index: number;
    searchStart: number;
    checked: number;
    requestedPages: string[];
    seen: string[];
  };
  pending?: {
    key: string;
    batch: PublicationBatch;
    articleKey?: string;
    advance: boolean;
  };
  visible: Record<string, string | null>;
  comparisons: Record<string, { before: Observation; after: Observation }>;
};
type Baseline = { news: { data: { articles: ReleaseArticle[] } } };
const keyOf = (a: ReleaseArticle) =>
  JSON.stringify(
    a.namespace && a.sourceId ? [a.namespace, a.sourceId] : [a.canonicalId],
  );
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const exposure = (path: string, key: string) => JSON.stringify([path, key]);
const prefix = "news-discovery/";
async function activeSnapshot() {
  const tmp = await mkdtemp(join(tmpdir(), "news-snapshot-"));
  try {
    const file = join(tmp, "response");
    const meta = JSON.parse(
      execFileSync(
        "aws",
        [
          "lambda",
          "invoke",
          "--function-name",
          required("NEWS_RELEASE_FUNCTION"),
          "--cli-binary-format",
          "raw-in-base64-out",
          "--payload",
          JSON.stringify({ operation: "release-snapshot" }),
          file,
        ],
        { encoding: "utf8" },
      ),
    );
    if (meta.FunctionError) throw new Error("Release snapshot request failed");
    return JSON.parse(await readFile(file, "utf8")) as {
      releaseId: string;
      roster: { bucket: string; key: string };
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
export async function runDaily(
  now = new Date(),
  deps = {
    store: createNewsStorage(),
    snapshot: activeSnapshot,
    consoleApi: searchConsole(
      required("SEARCH_CONSOLE_PROPERTY"),
      JSON.parse(required("SEARCH_CONSOLE_CREDENTIALS")),
    ),
    infer: createNewsInference(process.env),
    newsResults,
    readArticle,
    publish: publishDestinations,
    origin: new URL(required("NEWS_SITE_ORIGIN")).origin,
    bucket: required("NEWS_PRIVATE_BUCKET"),
    apiKey: required("SERPAPI_KEY"),
  },
) {
  const { store, consoleApi, origin, infer } = deps;
  const searchDate = chicagoDate(now);
  const snapshot = await deps.snapshot();
  if (snapshot.roster.bucket !== deps.bucket)
    throw new Error("Unexpected private roster bucket");
  const rosterObject = await store.readJson<Roster>(snapshot.roster.key);
  if (!rosterObject)
    throw new Error("Missing roster for " + snapshot.releaseId);
  const roster = rosterObject.value;
  const people = new Map(roster.personnel.map((p) => [p.id, p])),
    agencies = new Map(roster.agencies.map((a) => [a.id, a]));
  const paths = new Map(
    roster.personnel.filter((p) => p.path).map((p) => [p.path!, p]),
  );
  const assignments = new Map(roster.assignments.map((a) => [a.id, a]));
  const candidates = roster.assignments.map((a) => ({
    id: a.id,
    personnelName: people.get(a.personnelId)!.name,
    agencyName: agencies.get(a.agencyId)!.name,
  }));

  const window = await consoleApi.latestWindow(now);
  const traffic = await collectTraffic(
    (offset) => consoleApi.rows(window, offset),
    new Set(paths.keys()),
    origin,
  );
  const saved = await store.readJson<State>(prefix + "state.json");
  let etag = saved?.etag ?? null;
  const state: State = saved?.value ?? {
    releaseId: "",
    articles: [],
    matches: [],
    visible: {},
    comparisons: {},
  };
  async function save() {
    const key = prefix + "state.json";
    if (!(await store.writeJson(key, state, etag)))
      throw new Error("Another daily run advanced discovery");
    const latest = await store.readJson<State>(key);
    if (!latest || JSON.stringify(latest.value) !== JSON.stringify(state))
      throw new Error("Discovery state changed after save");
    etag = latest.etag;
  }
  if (state.releaseId !== snapshot.releaseId) {
    if (state.pending)
      throw new Error("Release changed during pending publication");
    const baseline = new Map<string, ReleaseArticle>();
    for (const path of new Set(["/", ...roster.coveragePaths])) {
      const object = await store.readJson<Baseline>(
        "builds/" + snapshot.releaseId + "/data" + path + "index.json",
      );
      if (!object) throw new Error("Missing release baseline at " + path);
      for (const a of object.value.news.data.articles) {
        const key = keyOf(a);
        baseline.set(key, a);
        const visibleKey = exposure(path, key);
        if (paths.has(path) && !Object.hasOwn(state.visible, visibleKey))
          state.visible[visibleKey] = null;
      }
    }
    // Existing discovery identities remain searchable across releases. The build's
    // canonical references are authoritative for articles it already includes.
    const known = new Map(state.articles.map((a) => [keyOf(a), a]));
    for (const [key, a] of baseline) {
      const prior = known.get(key);
      known.set(
        key,
        prior
          ? {
              ...prior,
              ...a,
              occurrences: { ...prior.occurrences, ...a.occurrences },
              relationships: mergeRelationships(prior, a),
            }
          : a,
      );
    }
    state.articles = [...known.values()];
    state.releaseId = snapshot.releaseId;
    delete state.queue;
    await save();
  }
  async function finish() {
    const pending = state.pending;
    if (!pending) return;
    const dates = await deps.publish(store, pending.key, pending.batch, roster);
    if (pending.articleKey)
      for (const [path, instant] of Object.entries(dates))
        if (
          paths.has(path) &&
          !Object.hasOwn(state.visible, exposure(path, pending.articleKey))
        )
          state.visible[exposure(path, pending.articleKey)] = instant;
    if (pending.advance) await advance("matched", pending.articleKey);
    delete state.pending;
    await save();
  }
  async function advance(
    outcome: "matched" | "url_limit" | "exhausted" | "missing_profile",
    articleKey?: string,
  ) {
    const q = state.queue!;
    const pair = q.pairs[q.index]!;
    const key = prefix + "outcomes/" + q.runId + "/" + q.index + ".json";
    await store.writeJson(
      key,
      {
        releaseId: state.releaseId,
        searchDate,
        window: q.window,
        term: pair.term,
        path: pair.path,
        newUrls: q.checked,
        providerRequests: q.requestedPages.length,
        outcome,
        articleKey,
      },
      null,
    );
    q.index++;
    q.searchStart = 0;
    q.checked = 0;
    q.requestedPages = [];
    q.seen = [];
  }
  await finish();

  const ranks =
    (await store.readJson<Record<string, number>>(prefix + "domain-ranks.json"))
      ?.value ?? {};
  async function evidence(url: string, budget: number) {
    const key = prefix + "urls/" + hash(url) + ".json";
    const cached = await store.readJson<{
      html: string;
      url: string;
      correctedSelector?: string;
      occurrence?: NewsOccurrence;
      reason?: string;
      checkedDate?: string;
    }>(key);
    const checkedDate = chicagoDate(now);
    if (
      cached?.value.reason &&
      cached.value.checkedDate === checkedDate &&
      !cached.value.correctedSelector
    )
      return { cached: true };
    if (!cached?.value.html && budget <= 0) return { cached: true };
    const source = cached?.value.html
      ? cached.value
      : await deps.readArticle(url);
    if (!source) {
      if (
        !(await store.writeJson(
          key,
          { url, reason: "Publisher unavailable", checkedDate },
          cached?.etag ?? null,
        ))
      )
        throw Error("URL evidence concurrently saved");
      return { cached: false };
    }
    let tag = cached?.etag ?? null;
    if (!cached) {
      if (!(await store.writeJson(key, source, null)))
        throw Error("URL evidence concurrently saved");
      tag = (await store.readJson(key))!.etag;
    }
    const occurrence = await processNewsOccurrence({
      url: source.url,
      html: source.html,
      correctedSelector: cached?.value.correctedSelector,
      assignments: candidates,
      infer,
      domainRank: domainRankFor(source.url, ranks),
    }).catch(async (error: unknown) => {
      if (
        !(
          error instanceof Error &&
          (error.message.startsWith("Article has no source title:") ||
            error.message.startsWith("Body selector did not match at "))
        )
      )
        throw error;
      if (
        !(await store.writeJson(
          key,
          { ...source, reason: error.message, checkedDate },
          tag,
        ))
      )
        throw Error("URL evidence concurrently saved");
      return null;
    });
    if (!occurrence) return { cached: Boolean(cached?.value.html) };
    if (!(await store.writeJson(key, { ...source, occurrence }, tag)))
      throw new Error("Article evidence changed during search");
    const relatedUrls = new Set<string>();
    for (const p of occurrence.paragraphs ?? []) {
      const pk = prefix + p.hash + "/index.json";
      const existing = await store.readJson<{
        text: string;
        occurrences: Record<string, string[]>;
      }>(pk);
      const occurrences = existing?.value.occurrences ?? {};
      for (const other of Object.keys(occurrences)) {
        if (other !== url) relatedUrls.add(other);
      }
      occurrences[url] = (occurrence.support ?? [])
        .filter((s) => s.paragraphHashes.includes(p.hash))
        .map((s) => s.assignmentId);
      if (
        !(await store.writeJson(
          pk,
          { text: normalizedParagraph(p.text), occurrences },
          existing?.etag ?? null,
        ))
      )
        throw new Error("Paragraph evidence changed during search");
    }
    const known: NewsOccurrence[] = [];
    for (const other of relatedUrls) {
      const ref = await store.readJson<{ occurrence?: NewsOccurrence }>(
        prefix + "urls/" + hash(other) + ".json",
      );
      if (ref?.value.occurrence) known.push(ref.value.occurrence);
    }
    return { cached: Boolean(cached?.value.html), occurrence, known };
  }
  function homeUpdate() {
    const newest = new Map<string, string>();
    const byDate = state.articles
      .map((article) => ({
        article,
        date:
          article.occurrences[article.preferredUrl]?.publishedAt?.slice(
            0,
            10,
          ) ?? "",
        key: keyOf(article),
      }))
      .filter(({ date }) => eligibleNewsDate(date, now))
      .sort(
        (a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key),
      );
    for (const { article, key } of byDate)
      for (const rel of article.relationships) {
        if (rel.needsCorrection) continue;
        const assignment = assignments.get(rel.agencyPersonnelId);
        const path = assignment && people.get(assignment.personnelId)?.path;
        if (path && !newest.has(path)) newest.set(path, key);
      }
    const list = homepageRanking(traffic, state.matches, newest);
    const articles = list.map(
      (row) => state.articles.find((a) => keyOf(a) === row.articleKey)!,
    );
    const placements = list.map((r, i) => ({
      namespace: articles[i]!.namespace,
      sourceId: articles[i]!.sourceId,
      canonicalId: articles[i]!.canonicalId,
      position: r.position,
      clicks: r.clicks,
    }));
    return { articles, ranking: { windowEnd: window.endDate, placements } };
  }
  async function publish(article?: ReleaseArticle) {
    const destinations: PublicationBatch["destinations"] = [];
    if (article) {
      const targets = new Set<string>();
      for (const rel of article.relationships) {
        const a = assignments.get(rel.agencyPersonnelId);
        if (!a) continue;
        for (const path of [
          people.get(a.personnelId)?.path,
          agencies.get(a.agencyId)?.path,
        ])
          if (path) targets.add(path);
      }
      for (const path of targets)
        destinations.push({ path, update: { articles: [article] } });
    }
    destinations.push({ path: "/", update: homeUpdate() });
    const batch = { releaseId: snapshot.releaseId, destinations };
    state.pending = {
      key: prefix + "batches/" + createId() + ".json",
      batch,
      articleKey: article ? keyOf(article) : undefined,
      advance: Boolean(article),
    };
    await save();
    await finish();
  }
  if (!state.queue || state.queue.index >= state.queue.pairs.length) {
    state.queue = {
      runId: createId(),
      window,
      pairs: traffic,
      index: 0,
      searchStart: 0,
      checked: 0,
      requestedPages: [],
      seen: [],
    };
    await save();
  }
  const q = state.queue;
  try {
    while (q.index < q.pairs.length) {
      const pair = q.pairs[q.index]!,
        person = paths.get(pair.path);
      if (!person) {
        await advance("missing_profile");
        await save();
        continue;
      }
      let found = false;
      while (q.checked < 10) {
        const pageKey =
          prefix +
          "searches/" +
          hash(
            JSON.stringify([
              searchDate,
              pairKey(pair),
              person.name,
              q.searchStart,
            ]),
          ) +
          ".json";
        const cachedPage = await store.readJson<{
          urls: string[];
          nextStart: number | null;
          requestedBy: string;
        }>(pageKey);
        const requestOwner = q.runId + "/" + q.index;
        const page = cachedPage?.value ?? {
          ...(await deps.newsResults(
            pair.term,
            person.name,
            q.searchStart,
            deps.apiKey,
          )),
          requestedBy: requestOwner,
        };
        if (!cachedPage && !(await store.writeJson(pageKey, page, null)))
          throw new Error("Search page concurrently saved");
        if (
          page.requestedBy === requestOwner &&
          !q.requestedPages.includes(pageKey)
        ) {
          q.requestedPages.push(pageKey);
          await save();
        }
        const result = await searchFirst(
          page.urls.filter((url) => !q.seen.includes(url)),
          async (url) => {
            const { cached, occurrence, known } = await evidence(
              url,
              10 - q.checked,
            );
            if (!cached) q.checked++;
            const merged = occurrence
              ? await mergeCurrentNews(state.articles, occurrence, {
                  now,
                  namespace: "google.news",
                  mint: createId,
                  summarize: async (body) => (await infer(body, [])).summary,
                  known,
                  read: async (cited) => {
                    const original = await evidence(cited, 10 - q.checked);
                    if (!original.cached) q.checked++;
                    return original.occurrence ?? null;
                  },
                })
              : undefined;
            const article = merged?.article;
            if (merged?.ambiguous.length || merged?.needsCorrection.length) {
              const key = prefix + "review/" + hash(url) + ".json",
                previous = await store.readJson(key);
              if (
                !(await store.writeJson(
                  key,
                  {
                    url,
                    ambiguous: merged.ambiguous,
                    needsCorrection: merged.needsCorrection,
                  },
                  previous?.etag ?? null,
                ))
              )
                throw new Error("Review evidence concurrently changed");
            }
            if (
              article &&
              occurrence?.support?.some(
                (s) =>
                  assignments.get(s.assignmentId)?.personnelId === person.id,
              )
            ) {
              return { cached, match: article };
            }
            q.seen.push(url);
            await save();
            return { cached, exhausted: q.checked >= 10 };
          },
          10 - q.checked,
        );
        if (result.match) {
          const article = result.match,
            k = keyOf(article);
          const index = state.articles.findIndex((a) => keyOf(a) === k);
          if (index < 0) state.articles.push(article);
          else state.articles[index] = article;
          if (
            !state.matches.some(
              (m) => pairKey(m) === pairKey(pair) && m.articleKey === k,
            )
          )
            state.matches.push({
              term: pair.term,
              path: pair.path,
              articleKey: k,
            });
          await publish(article);
          found = true;
          break;
        }
        if (page.nextStart === null || q.checked >= 10) break;
        q.searchStart = page.nextStart;
        await save();
      }
      if (!found) {
        await advance(q.checked >= 10 ? "url_limit" : "exhausted");
        await save();
      }
    }
  } catch (error) {
    if (!(error instanceof ProviderAllowance)) throw error;
    await save();
  }
  await publish();
  for (const m of state.matches) {
    const key = JSON.stringify([m.term, m.path, m.articleKey]);
    const visible = state.visible[exposure(m.path, m.articleKey)];
    if (!visible || state.comparisons[key]) continue;
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(visible));
    if (shiftDate(day, 7) > window.endDate) continue;
    async function measure(start: number, end: number) {
      const startDate = shiftDate(day, start),
        endDate = shiftDate(day, end);
      return {
        startDate,
        endDate,
        position: await consoleApi.position(
          m.term,
          origin + m.path,
          startDate,
          endDate,
        ),
      };
    }
    state.comparisons[key] = {
      before: await measure(-7, -1),
      after: await measure(1, 7),
    };
    await save();
  }
}
function mergeRelationships(older: ReleaseArticle, current: ReleaseArticle) {
  const key = (r: ReleaseArticle["relationships"][number]) =>
    r.agencyPersonnelId;
  return [
    ...new Map(
      [...older.relationships, ...current.relationships].map((r) => [
        key(r),
        r,
      ]),
    ).values(),
  ];
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  await runDaily();
