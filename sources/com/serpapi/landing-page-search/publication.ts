import { normalizeCoverageUrl } from "../../../../src/cli/import/artifacts/facades/coverage-resolvers.js";
import { HTMLElement, parse } from "node-html-parser";
import {
  selectPreferredOccurrence,
  selectSupportedOccurrence,
  type ReleaseArticle,
  type ReleaseIdentity,
  type ReleaseRelationship,
} from "../../../lib/news.js";
import { pageKey, type NewsStorage, type Stored } from "./storage.js";

import {
  articleKeys,
  recordKey,
  saveNewsAliases,
  type NewsAliases,
} from "./aliases.js";

export type { ReleaseArticle } from "../../../lib/news.js";
type PageEntity = {
  id: string;
  name: string;
  path: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string;
};
export type Roster = {
  agencies: PageEntity[];
  personnel: PageEntity[];
  assignments: { id: string; agencyId: string; personnelId: string }[];
};
export type Ranking = {
  windowEnd: string;
  placements: (ReleaseIdentity & { position: number; clicks: number })[];
};
type Part = {
  appliedPublications?: string[];
  target: string;
  template: { fromOriginal: string } | { html: string };
  data: Record<string, unknown>;
};
export type PageObject = Record<string, Part>;
type NewsData = { articles: ReleaseArticle[]; ranking?: Ranking };
export type PageUpdate = {
  articles?: ReleaseArticle[];
  ranking?: Ranking;
  parts?: PageObject;
};
export type PublicationBatch = {
  releaseId: string;
  destinations: { path: string; update: PageUpdate }[];
};
type Checkpoint = PublicationBatch & {
  visible: Record<string, string>;
  complete: boolean;
};
function mergeArticle(current: ReleaseArticle, incoming: ReleaseArticle) {
  const occurrences = { ...current.occurrences };
  for (const [url, copy] of Object.entries(incoming.occurrences)) {
    const existing = occurrences[url];
    const latest =
      !existing || (copy.observedAt ?? "") >= (existing.observedAt ?? "");
    occurrences[url] = latest
      ? { ...existing, ...copy }
      : { ...copy, ...existing };
  }
  const relationships = new Map(
    current.relationships.map((r) => [r.agencyPersonnelId, r]),
  );
  for (const r of incoming.relationships) {
    const old = relationships.get(r.agencyPersonnelId);
    if (old?.canonicalId && r.canonicalId && old.canonicalId !== r.canonicalId)
      throw Error(
        "Conflicting coverage relationship IDs for " + r.agencyPersonnelId,
      );
    relationships.set(r.agencyPersonnelId, {
      ...old,
      ...r,
      ...(old?.namespace &&
        old.sourceId && { namespace: old.namespace, sourceId: old.sourceId }),
    });
  }
  for (const [key, relation] of relationships) {
    const supported = selectSupportedOccurrence(relation, occurrences);
    if (supported) {
      const updated = { ...relation, occurrenceUrl: supported.url };
      delete updated.needsCorrection;
      relationships.set(key, updated);
    } else if (
      relation.occurrenceUrl &&
      occurrences[relation.occurrenceUrl]?.support
    ) {
      relationships.set(key, { ...relation, needsCorrection: true });
    }
  }
  const preferred = selectPreferredOccurrence(Object.values(occurrences));
  const existingOrigin =
    !current.canonicalId && incoming.canonicalId && incoming.sourceId
      ? incoming
      : current;
  return {
    ...current,
    ...incoming,
    ...(existingOrigin.namespace &&
      existingOrigin.sourceId && {
        namespace: existingOrigin.namespace,
        sourceId: existingOrigin.sourceId,
      }),
    occurrences,
    preferredUrl: preferred.url,
    normalizedUrl: normalizeCoverageUrl(preferred.url),
    relationships: [...relationships.values()],
  };
}
export function addReleaseArticle(
  articles: ReleaseArticle[],
  incoming: ReleaseArticle,
  aliases: NewsAliases,
) {
  const keys = articleKeys(incoming, aliases);
  const matches = articles.filter((article) =>
    [...articleKeys(article, aliases)].some((key) => keys.has(key)),
  );
  if (
    new Set([...matches, incoming].map((a) => a.canonicalId).filter(Boolean))
      .size > 1
  )
    throw Error(
      "Conflicting canonical coverage IDs for " + recordKey(incoming),
    );
  const merged = matches.length
    ? [...matches.slice(1), incoming].reduce(mergeArticle, matches[0])
    : incoming;
  for (const old of matches) articles.splice(articles.indexOf(old), 1);
  articles.push(merged);
  return merged;
}
function mergePage(
  page: PageObject,
  update: PageUpdate,
  aliases: NewsAliases,
): PageObject {
  const parts = { ...page, ...update.parts };
  if (!update.articles && !update.ranking) return parts;
  const news = parts.news;
  if (!news || !Array.isArray(news.data.articles))
    throw new Error("Missing release news baseline");
  const data = news.data as NewsData;
  const articles: ReleaseArticle[] = [];
  for (const article of [...data.articles, ...(update.articles ?? [])])
    addReleaseArticle(articles, article, aliases);
  const ranking =
    update.ranking &&
    (!data.ranking || update.ranking.windowEnd >= data.ranking.windowEnd)
      ? update.ranking
      : data.ranking;
  return {
    ...parts,
    news: {
      ...news,
      data: {
        ...data,
        articles,
        ...(ranking && { ranking }),
      },
    },
  };
}
function escapeText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function required(root: HTMLElement, selector: string) {
  const el = root.querySelector(selector);
  if (!el) throw new Error("Missing page element " + selector);
  return el;
}
function tag(el: HTMLElement, ref: ReleaseIdentity) {
  if (ref.namespace && ref.sourceId) {
    el.setAttribute("data-source-namespace", escapeText(ref.namespace));
    el.setAttribute("data-source-id", escapeText(ref.sourceId));
  }
}
function optionalText(
  item: HTMLElement,
  selector: string,
  text: string | null | undefined,
) {
  const el = required(item, selector);
  if (text) el.textContent = text;
  else el.remove();
}
function indexRoster(roster: Roster) {
  return {
    people: new Map(roster.personnel.map((p) => [p.id, p])),
    agencies: new Map(roster.agencies.map((a) => [a.id, a])),
    assignments: new Map(roster.assignments.map((r) => [r.id, r])),
  };
}
type Index = ReturnType<typeof indexRoster>;
const indexed = new WeakMap<Roster, Index>();
function storyAt(article: ReleaseArticle, path: string, index: Index) {
  const relationships: Array<{ rel: ReleaseRelationship; person: PageEntity }> =
    [];
  if (path !== "/")
    for (const rel of article.relationships) {
      const assignment = index.assignments.get(rel.agencyPersonnelId);
      if (!assignment)
        throw new Error("Unknown assignment " + rel.agencyPersonnelId);
      const person = index.people.get(assignment.personnelId),
        agency = index.agencies.get(assignment.agencyId);
      if (!person || !agency)
        throw new Error("Roster entry missing for " + assignment.id);
      if (person.path === path || agency.path === path)
        relationships.push({ rel, person });
    }
  if (path !== "/" && !relationships.length)
    throw new Error("No supporting assignment for " + path);
  const supported = relationships.map(
    ({ rel }) => article.occurrences[rel.occurrenceUrl ?? article.preferredUrl],
  );
  if (supported.some((o) => !o))
    throw new Error("Missing supporting source on " + path);
  const occurrence =
    !supported.length || supported.some((o) => o.url === article.preferredUrl)
      ? article.occurrences[article.preferredUrl]
      : selectPreferredOccurrence(supported);
  if (!occurrence)
    throw new Error("Missing preferred source " + article.preferredUrl);
  relationships.sort(
    (a, b) =>
      (a.person.lastName ?? "").localeCompare(b.person.lastName ?? "") ||
      (a.person.firstName ?? a.person.name).localeCompare(
        b.person.firstName ?? b.person.name,
      ) ||
      a.rel.agencyPersonnelId.localeCompare(b.rel.agencyPersonnelId),
  );
  return { article, occurrence, relationships };
}
function renderNews(
  target: HTMLElement,
  template: string,
  data: NewsData,
  path: string,
  index: Index,
  aliases: NewsAliases,
) {
  const articles = new Map(
    data.articles.flatMap((a) =>
      [...articleKeys(a, aliases)].map((key) => [key, a] as const),
    ),
  );
  const selected =
    path === "/" && data.ranking
      ? [...data.ranking.placements]
          .sort((a, b) => a.position - b.position)
          .map((ref) => {
            const article = articles.get(recordKey(ref, aliases));
            if (!article)
              throw new Error(
                "Ranked article missing: " + recordKey(ref, aliases),
              );
            return article;
          })
      : data.articles;
  const stories = selected.map((a) => storyAt(a, path, index));
  if (path !== "/")
    stories.sort(
      (a, b) =>
        (b.occurrence.publishedAt ?? "").localeCompare(
          a.occurrence.publishedAt ?? "",
        ) ||
        a.occurrence.title.localeCompare(b.occurrence.title) ||
        recordKey(
          a.occurrence.sourceId ? a.occurrence : a.article,
        ).localeCompare(
          recordKey(b.occurrence.sourceId ? b.occurrence : b.article),
        ),
    );
  const list = required(target, "[data-news-list]");
  list.innerHTML = "";
  if (stories.length) target.removeAttribute("hidden");
  else target.setAttribute("hidden", "");
  for (const { article, occurrence, relationships } of stories) {
    const item = parse(template).firstElementChild;
    if (!item) throw new Error("Missing coverage item template");
    tag(item, occurrence.sourceId ? occurrence : article);
    const anchor = required(item, "[data-news-title]");
    const url = new URL(occurrence.url);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error("Invalid news article URL");
    anchor.setAttribute("href", occurrence.url.replaceAll("&", "&amp;"));
    anchor.textContent = occurrence.title;
    optionalText(item, "[data-news-publisher]", occurrence.sourceName);
    optionalText(item, "[data-news-summary]", occurrence.summary);
    optionalText(item, "[data-news-notes]", article.notes);
    const wrapper = required(item, "[data-news-date]");
    if (occurrence.publishedAt) {
      const time = required(wrapper, "time"),
        date = new Date(occurrence.publishedAt);
      time.setAttribute("datetime", date.toISOString());
      time.textContent = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
    } else wrapper.remove();
    const officers = required(item, "[data-news-officers]");
    if (!relationships.length) officers.remove();
    for (const [n, { rel, person }] of relationships.entries()) {
      const name = person.displayName ?? person.name;
      if (n) officers.append(", ");
      const link = parse(
        person.path ? "<a></a>" : "<span></span>",
      ).firstElementChild!;
      tag(link, rel);
      if (person.path) link.setAttribute("href", person.path);
      link.textContent = name;
      officers.appendChild(link);
    }
    list.appendChild(item);
  }
}
export function renderPage(
  original: string,
  page: PageObject,
  path: string,
  roster: Roster,
  aliases: NewsAliases = {},
) {
  const doc = parse(original, { comment: true });
  let index = indexed.get(roster);
  if (!index) {
    index = indexRoster(roster);
    indexed.set(roster, index);
  }
  const instructions = Object.entries(page).map(([key, part]) => ({
    key,
    part,
    target: required(doc, part.target),
    template:
      "html" in part.template
        ? part.template.html
        : required(doc, part.template.fromOriginal).innerHTML,
  }));
  for (const { key, part, target, template } of instructions) {
    if (key === "news") {
      renderNews(target, template, part.data as NewsData, path, index, aliases);
      continue;
    }
    const fragment = parse(template);
    for (const slot of fragment.querySelectorAll("[data-part-text]")) {
      const name = slot.getAttribute("data-part-text")!,
        value = part.data[name];
      if (typeof value !== "string")
        throw new Error("Missing page text " + name);
      slot.textContent = value;
    }
    target.innerHTML = fragment.toString();
  }
  return doc.toString();
}
export async function publishPage(
  storage: NewsStorage,
  releaseId: string,
  path: string,
  roster: Roster,
  update: PageUpdate,
  publicationKey?: string,
  aliases: NewsAliases = {},
) {
  const key = pageKey(releaseId, "data", path);
  async function readPage() {
    const saved = await storage.readJson<PageObject>(key);
    if (!saved) throw new Error("Missing release page data: " + key);
    return saved;
  }
  const changedParts = new Set(Object.keys(update.parts ?? {}));
  if (update.articles || update.ranking) changedParts.add("news");
  for (;;) {
    const saved = await readPage();
    const applied = (part: string) =>
      saved.value[part]?.appliedPublications ?? [];
    // The receipt and its changes commit in one conditional page write. A
    // restarted batch must still render, but must not apply stale inputs twice.
    if (
      publicationKey &&
      [...changedParts].every((part) => applied(part).includes(publicationKey))
    )
      break;
    const next = mergePage(saved.value, update, aliases);
    if (publicationKey) {
      for (const part of changedParts) {
        next[part] = {
          ...next[part],
          appliedPublications: [...new Set([...applied(part), publicationKey])],
        };
      }
    } else {
      for (const part of changedParts) {
        if (applied(part).length)
          next[part] = { ...next[part], appliedPublications: applied(part) };
      }
    }
    if (
      JSON.stringify(saved.value) === JSON.stringify(next) ||
      (await storage.writeJson(key, next, saved.etag))
    )
      break;
  }
  // Capture the output version before reading the input. A concurrent publication
  // either blocks this write or follows it using data at least as recent.
  for (;;) {
    const previous = await storage.readOverrideEtag(releaseId, path);
    const saved = await readPage();
    const html = renderPage(
      await storage.readOriginal(releaseId, path),
      saved.value,
      path,
      roster,
      aliases,
    );
    if (!(await storage.writeOverride(releaseId, path, html, previous)))
      continue;
    if ((await readPage()).etag !== saved.etag) continue;
    await storage.makeVisible(releaseId, path);
    return;
  }
}
export async function publishDestinations(
  storage: NewsStorage,
  key: string,
  initial: PublicationBatch,
  roster: Roster,
): Promise<Record<string, string>> {
  async function checkpoint(): Promise<Stored<Checkpoint>> {
    const record = await storage.readJson<Checkpoint>(key);
    if (!record) throw new Error("Missing publication checkpoint: " + key);
    return record;
  }
  let entry = await storage.readJson<Checkpoint>(key);
  if (!entry) {
    await storage.writeJson(
      key,
      { ...initial, visible: {}, complete: false },
      null,
    );
    entry = await checkpoint();
  }
  const batch = entry.value;
  if (batch.complete) return batch.visible;
  let pinnedRoster = roster;
  if (batch.releaseId !== initial.releaseId) {
    const saved = await storage.readJson<Roster>(
      `builds/${batch.releaseId}/data/dynamic.json`,
    );
    if (!saved) throw new Error("Missing pinned release roster");
    pinnedRoster = saved.value;
  }
  const aliases = await saveNewsAliases(storage, batch.releaseId, [
    ...new Set(batch.destinations.flatMap((d) => d.update.articles ?? [])),
  ]);
  for (const { path, update } of batch.destinations) {
    await publishPage(
      storage,
      batch.releaseId,
      path,
      pinnedRoster,
      update,
      key,
      aliases,
    );
    const firstVisible = new Date().toISOString();
    for (;;) {
      const current = await checkpoint();
      if (
        current.value.visible[path] ||
        (await storage.writeJson(
          key,
          {
            ...current.value,
            visible: { ...current.value.visible, [path]: firstVisible },
          },
          current.etag,
        ))
      )
        break;
    }
  }
  for (;;) {
    const current = await checkpoint();
    if (
      current.value.complete ||
      (await storage.writeJson(
        key,
        { ...current.value, complete: true },
        current.etag,
      ))
    )
      return current.value.visible;
  }
}
