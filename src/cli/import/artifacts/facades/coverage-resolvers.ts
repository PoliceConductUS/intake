import {
  Resolver,
  valueAsString,
  type ResolverContext,
} from "../resolver-kit.js";

type Row = Record<string, unknown>;

function youtubeVideoId(host: string, url: URL): string | null {
  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = url.searchParams.get("v");
    if (v !== null && v !== "") return v;
    const shorts = url.pathname.match(/^\/shorts\/([\w-]+)/);
    if (shorts !== null) return shorts[1];
    const embed = url.pathname.match(/^\/embed\/([\w-]+)/);
    if (embed !== null) return embed[1];
  }
  if (host === "youtu.be") {
    const id = url.pathname.replace(/^\/+/, "");
    if (id !== "") return id;
  }
  return null;
}

const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_|igshid$|si$)/i;

/** The de-duplicating natural key of a coverage URL (ADR 0028). */
export function normalizeCoverageUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed.toLowerCase();
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  const videoId = youtubeVideoId(host, url);
  if (videoId !== null) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAM.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(params).toString();
  const path = url.pathname.replace(/\/+$/, "");
  return `https://${host}${path}${query === "" ? "" : `?${query}`}`;
}

/** CoverageLink identity: the normalized `url` (ADR 0028); no mint. */
export function coverageLinkIdResolver(): Resolver<
  string,
  ResolverContext<Row, unknown>
> {
  return new Resolver(async ({ facade, source }) => {
    const url = valueAsString(facade.raw("url"));
    if (url === undefined) {
      throw new Error(
        `CoverageLink ${source.namespace}/${source.name} has no url to key on.`,
      );
    }
    return normalizeCoverageUrl(url);
  });
}

/**
 * A CoverageLinkCivilCase's civil_case_id references an EXISTING civil case by its
 * natural key (court:docket, ADR 0028), produced by another source — so it passes
 * through as the canonical id, not a same-run facade find.
 */
export function civilCaseReferenceResolver(): Resolver<
  string,
  ResolverContext<Row, unknown>
> {
  return new Resolver(async ({ facade, source }) => {
    const id = valueAsString(facade.raw("civil_case_id"));
    if (id === undefined) {
      throw new Error(
        `CoverageLinkCivilCase ${source.namespace}/${source.name} has no civil_case_id.`,
      );
    }
    return id;
  });
}
