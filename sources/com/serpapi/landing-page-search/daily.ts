import {
  personnelSearchNames,
  personnelNameEvidence,
} from "../../../lib/personnel-names.js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  bodyNameMatcher,
  chicagoDate,
  eligibleNewsDate,
  mergeCurrentNews,
  normalizedParagraph,
  NewsExtractionError,
  processNewsOccurrence,
  type ReleaseArticle,
  type NewsOccurrence,
} from "../../../lib/news.js";
import { domainRankFor } from "../../../lib/news-ranks.js";
import { createNewsInference } from "../../../lib/news-inference.js";
import { createNewsStorage } from "./storage.js";
import {
  articleKeys,
  newsNamespace,
  publisherRef,
  readNewsAliases,
  recordKey,
  samePublisherGroup,
} from "./aliases.js";
import {
  addReleaseArticle,
  publishDestinations,
  type PublicationBatch,
} from "./publication.js";

type Person = {
  id: string;
  name: string;
  path: string | null;
  firstName?: string;
  lastName?: string | null;
  middleName?: string | null;
  suffix?: string | null;
  displayName?: string;
};
type Roster = {
  personnel: Person[];
  agencies: (Person & { state: string })[];
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
  termSearches?: Record<string, string>;
  queue?: {
    runId: string;
    searchDate?: string;
    window: Window;
    pairs: Traffic[];
    index: number;
    searchStart: number;
    checked: number;
    requestedPages: string[];
    seen: string[];
    decisions?: Array<Record<string, unknown>>;
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
const keyOf = recordKey;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const exposure = (path: string, key: string) => JSON.stringify([path, key]);
const prefix = newsNamespace + "/";
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
  at?: Date,
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
  const clock = () => at ?? new Date();
  const now = clock();
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
  const namesByPerson = new Map(
    roster.personnel.map((p) => [p.id, personnelSearchNames(p)]),
  );
  const candidates = roster.assignments.map((a) => ({
    id: a.id,
    personnelName: people.get(a.personnelId)!.name,
    personnelNames: namesByPerson.get(a.personnelId)!,
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
  const termSearches = new Map(Object.entries(state.termSearches ?? {}));
  async function save() {
    const key = prefix + "state.json";
    if (!(await store.writeJson(key, state, etag)))
      throw new Error("Another daily run advanced discovery");
    const latest = await store.readJson<State>(key);
    if (!latest || JSON.stringify(latest.value) !== JSON.stringify(state))
      throw new Error("Discovery state changed after save");
    etag = latest.etag;
  }
  async function finish() {
    const pending = state.pending;
    if (!pending) return;
    const release = pending.batch.releaseId;
    const pinnedRoster =
      release === snapshot.releaseId
        ? roster
        : (await store.readJson<Roster>(`builds/${release}/data/dynamic.json`))
            ?.value;
    if (!pinnedRoster)
      throw Error("Missing roster for pending release " + release);
    const profilePaths = new Set(pinnedRoster.personnel.map((p) => p.path));
    const dates = await deps.publish(
      store,
      pending.key,
      pending.batch,
      pinnedRoster,
    );
    if (pending.articleKey)
      for (const [path, instant] of Object.entries(dates))
        if (
          profilePaths.has(path) &&
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
    const person = paths.get(pair.path);
    const audit = {
      releaseId: state.releaseId,
      searchDate: q.searchDate ?? searchDate,
      window: q.window,
      term: pair.term,
      path: pair.path,
      personnel: person,
      variations: person && namesByPerson.get(person.id),
      newUrls: q.checked,
      providerRequests: q.requestedPages.length,
      requestedPages: q.requestedPages,
      decisions: q.decisions ?? [],
      outcome,
      articleKey,
    };
    if (!(await store.writeJson(key, audit, null))) {
      const savedAudit = await store.readJson(key);
      if (JSON.stringify(savedAudit?.value) !== JSON.stringify(audit))
        throw Error("Conflicting saved search outcome");
    }
    delete state.queue;
  }
  await finish();
  let aliases = await readNewsAliases(store, snapshot.releaseId);
  if (state.releaseId !== snapshot.releaseId) {
    const visibleBaselines: { path: string; article: ReleaseArticle }[] = [];
    for (const path of new Set(["/", ...roster.coveragePaths])) {
      const object = await store.readJson<Baseline>(
        "builds/" + snapshot.releaseId + "/data" + path + "index.json",
      );
      if (!object) throw new Error("Missing release baseline at " + path);
      for (const article of object.value.news.data.articles) {
        addReleaseArticle(state.articles, article, aliases);
        if (paths.has(path)) visibleBaselines.push({ path, article });
      }
    }
    for (const { path, article } of visibleBaselines) {
      const keys = articleKeys(article, aliases);
      const merged = state.articles.find((a) =>
        [...articleKeys(a, aliases)].some((key) => keys.has(key)),
      )!;
      if (visibleAt(path, merged) === undefined)
        state.visible[exposure(path, keyOf(merged))] = null;
    }
    state.releaseId = snapshot.releaseId;
    delete state.queue;
    await save();
  }
  function visibleAt(path: string, article: ReleaseArticle) {
    const keys = articleKeys(article, aliases);
    const dates: string[] = [];
    for (const [key, date] of Object.entries(state.visible)) {
      const [p, ref] = JSON.parse(key) as [string, string];
      if (p === path && keys.has(resolveKey(ref))) {
        if (date === null) return null;
        dates.push(date);
      }
    }
    return dates.length ? dates.sort()[0] : undefined;
  }
  function resolveKey(key: string) {
    const [first, second] = JSON.parse(key) as string[];
    return second === undefined
      ? key
      : recordKey({ namespace: first, sourceId: second }, aliases);
  }

  const ranks =
    (await store.readJson<Record<string, number>>(prefix + "domain-ranks.json"))
      ?.value ?? {};
  async function evidence(url: string, budget: number) {
    const key = prefix + "urls/" + hash(url) + ".json";
    const cached = await store.readJson<{
      html: string;
      url: string;
      extractionFailed?: boolean;
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
      return { cached: true, reason: cached.value.reason };
    const reuseBody = Boolean(
      cached?.value.html &&
      (!cached.value.reason || cached.value.extractionFailed),
    );
    if (!reuseBody && budget <= 0) return { cached: true, reason: "URL limit" };
    const source =
      reuseBody && cached
        ? { ...cached.value, reason: undefined, extractionFailed: undefined }
        : await deps.readArticle(url);
    if (!source || source.reason) {
      const reason = source?.reason ?? "Publisher unavailable";
      if (
        !(await store.writeJson(
          key,
          { ...source, url: source?.url ?? url, reason, checkedDate },
          cached?.etag ?? null,
        ))
      )
        throw Error("URL evidence concurrently saved");
      return { cached: false, reason };
    }
    let tag = cached?.etag ?? null;
    if (!cached) {
      if (!(await store.writeJson(key, source, null)))
        throw Error("URL evidence concurrently saved");
      tag = (await store.readJson(key))!.etag;
    }
    let extractionError: string | undefined;
    const extracted = await processNewsOccurrence({
      url: source.url,
      html: source.html,
      correctedSelector: cached?.value.correctedSelector,
      assignments: candidates,
      infer,
      domainRank: domainRankFor(source.url, ranks),
    }).catch(async (error: unknown) => {
      if (!(error instanceof NewsExtractionError)) throw error;
      extractionError = error.message;
      if (
        !(await store.writeJson(
          key,
          {
            ...source,
            reason: error.message,
            extractionFailed: true,
            checkedDate,
          },
          tag,
        ))
      )
        throw Error("URL evidence concurrently saved");
      return null;
    });
    if (!extracted) return { cached: reuseBody, reason: extractionError };
    const occurrence = { ...extracted, ...publisherRef(extracted.url) };
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
      if (ref?.value.occurrence)
        known.push({
          ...ref.value.occurrence,
          ...publisherRef(ref.value.occurrence.url),
        });
    }
    return { cached: reuseBody, occurrence, known };
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
    const articles = list.map((row) =>
      state.articles.find((a) => keyOf(a) === row.articleKey)!,
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
  function nextPair(instant: Date) {
    const day = chicagoDate(instant);
    const cutoff = instant.getTime() - 168 * 60 * 60 * 1000;
    let searchedToday = 0;
    for (const timestamp of termSearches.values()) {
      if (chicagoDate(new Date(timestamp)) === day) searchedToday++;
    }
    if (searchedToday >= 5) return;
    return traffic.find(({ term }) => {
      const timestamp = termSearches.get(term);
      return timestamp === undefined || Date.parse(timestamp) <= cutoff;
    });
  }
  try {
    while (true) {
      if (!state.queue || state.queue.index >= state.queue.pairs.length) {
        const instant = clock();
        const pair = nextPair(instant);
        if (!pair) break;
        state.queue = {
          runId: createId(),
          searchDate: chicagoDate(instant),
          window,
          pairs: [pair],
          index: 0,
          searchStart: 0,
          checked: 0,
          requestedPages: [],
          seen: [],
        };
        await save();
      }
      const q = state.queue;
      const pair = q.pairs[q.index]!,
        person = paths.get(pair.path);
      if (!person) {
        await advance("missing_profile");
        await save();
        continue;
      }
      const scopes = new Set<string>();
      for (const assignment of roster.assignments) {
        if (assignment.personnelId !== person.id) continue;
        const agency = agencies.get(assignment.agencyId);
        if (!agency?.name || !agency.state)
          throw new Error(
            "Missing agency name or state for assignment " + assignment.id,
          );
        scopes.add(JSON.stringify(agency.name) + " " + agency.state);
      }
      const alternatives = [...scopes].sort();
      if (!alternatives.length)
        throw new Error("Missing agency assignments for " + pair.path);
      const scope =
        alternatives.length === 1
          ? alternatives[0]
          : "(" +
            alternatives.map((value) => "(" + value + ")").join(" OR ") +
            ")";
      const variations = namesByPerson.get(person.id)!;
      const quotedNames = variations.map((name) => JSON.stringify(name));
      const group =
        quotedNames.length === 1
          ? quotedNames[0]
          : "(" + quotedNames.join(" OR ") + ")";
      const query = [JSON.stringify(pair.term), group, scope].join(" ");
      let found = false;
      while (q.checked < 10) {
        const pageQuery = query;
        const pageKey =
          prefix +
          "searches/" +
          hash(
            JSON.stringify([
              q.searchDate ?? searchDate,
              pairKey(pair),
              "organic_results",
              pageQuery,
              q.searchStart,
            ]),
          ) +
          ".json";
        const cachedPage = await store.readJson<{
          urls: string[];
          nextStart: number | null;
          requestedBy: string;
          receivedAt?: string;
        }>(pageKey);
        const requestOwner = q.runId + "/" + q.index;
        const page = cachedPage?.value ?? {
          ...(await deps.newsResults(pageQuery, q.searchStart, deps.apiKey)),
          requestedBy: requestOwner,
          receivedAt: clock().toISOString(),
        };
        if (!cachedPage && !(await store.writeJson(pageKey, page, null)))
          throw new Error("Search page concurrently saved");
        if (q.searchStart === 0 && q.requestedPages.length === 0) {
          termSearches.set(pair.term, page.receivedAt ?? clock().toISOString());
          state.termSearches = Object.fromEntries(termSearches);
        }
        if (!q.requestedPages.includes(pageKey)) {
          if (page.requestedBy === requestOwner) q.requestedPages.push(pageKey);
          await save();
        }
        const result = await searchFirst(
          page.urls.filter((url) => !q.seen.includes(url)),
          async (url) => {
            const { cached, occurrence, known, reason } = await evidence(
              url,
              10 - q.checked,
            );
            if (!cached) q.checked++;
            const merged = occurrence
              ? await mergeCurrentNews(state.articles, occurrence, {
                  now,
                  namespace: newsNamespace,
                  sameSource: (a, b) => samePublisherGroup(a, b, aliases),
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
            const supported =
              occurrence?.support?.some(
                (s) =>
                  assignments.get(s.assignmentId)?.personnelId === person.id,
              ) ?? false;
            const matched = Boolean(article && supported);
            const hasName = occurrence?.body
              ? bodyNameMatcher(occurrence.body)
              : undefined;
            const nameEvidence = occurrence?.paragraphs
              ? personnelNameEvidence(variations, occurrence.paragraphs)
              : null;
            const matchingNames = nameEvidence?.map((hit) => hit.name) ?? null;
            const matchingAgencies = hasName
              ? [
                  ...new Set(
                    candidates
                      .filter(
                        (c) =>
                          assignments.get(c.id)?.personnelId === person.id &&
                          hasName(c.agencyName),
                      )
                      .map((c) => c.agencyName),
                  ),
                ]
              : null;
            (q.decisions ??= []).push({
              url,
              publisherUrl: occurrence?.url,
              pageKey,
              query: pageQuery,
              offset: q.searchStart,
              position: page.urls.indexOf(url) + 1,
              cached,
              evidenceKey: prefix + "urls/" + hash(url) + ".json",
              nameEvidence,
              matchingNames,
              matchingAgencies,
              publishedAt: occurrence?.publishedAt ?? null,
              current: occurrence
                ? eligibleNewsDate(occurrence.publishedAt, now)
                : null,
              supported,
              matched,
              reason:
                reason ??
                (matched
                  ? "Matched"
                  : matchingNames?.length === 0
                    ? "No roster name in the article paragraphs"
                    : !supported
                      ? "No supported assignment for this profile"
                      : "Story did not pass date or source checks"),
            });
            if (article && matched) return { cached, match: article };
            q.seen.push(url);
            await save();
            return { cached, exhausted: q.checked >= 10 };
          },
          10 - q.checked,
        );
        if (result.match) {
          const article = addReleaseArticle(
              state.articles,
              result.match,
              aliases,
            ),
            k = keyOf(article);
          const keys = articleKeys(article, aliases);
          if (
            !state.matches.some(
              (m) =>
                pairKey(m) === pairKey(pair) &&
                keys.has(resolveKey(m.articleKey)),
            )
          )
            state.matches.push({
              term: pair.term,
              path: pair.path,
              articleKey: k,
            });
          await publish(article);
          aliases = await readNewsAliases(store, snapshot.releaseId);
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
    if (state.queue?.searchStart === 0 && !state.queue.requestedPages.length)
      delete state.queue;
    await save();
  }
  await publish();
  for (const m of state.matches) {
    const key = JSON.stringify([m.term, m.path, m.articleKey]);
    const article = state.articles.find((a) =>
      articleKeys(a, aliases).has(resolveKey(m.articleKey)),
    );
    const visible = article && visibleAt(m.path, article);
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
