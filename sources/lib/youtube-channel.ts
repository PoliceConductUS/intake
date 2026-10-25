// One accountability YouTube channel as a coverage source, parameterized.
//
// Six channels are being added as independent sources (issue #52 family). They
// differ only in handle, pinned channel id, and display name, so the behavior
// that must not drift between them — the rolling five-year window, the pinned
// channel-id check, case-preserving URL canonicalization, and the never-guess
// resolve gate — lives here once and each source is a thin config.
//
// Division of phases follows ADR 0022/0023: `acquire` owns the network and the
// clock and writes the window it used into every envelope; `transform` is a pure
// function of those envelopes, so re-running it reproduces the same links.

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  AcquireDeps,
  EmittedRecords,
  SourceAcquire,
  SourceTransform,
  TransformDeps,
} from "../../src/cli/transform/source-transform.js";
import { isPersonName, slugify } from "./civil-defendants.js";
import {
  createYoutubeApi,
  isQuotaExhaustedBody,
  quotaResetHint,
  YoutubeQuotaError,
} from "./youtube.js";
import {
  loadVideoCache,
  mergedVideos,
  planYearToAcquire,
  pruneYearsBefore,
  saveVideoCache,
  type AcquiredVideo,
} from "./youtube-video-cache.js";

/** Only videos published within this many years of a run are considered. */
export const ROLLING_WINDOW_YEARS = 5;
/** How long a current-year search stays fresh before the next run redoes it. */
const DEFAULT_REFRESH_DAYS = 7;
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 60_000;
// Be gentle: a small pause between agency searches (we are in no rush).
const POLITE_DELAY_MS = 250;

export type ChannelSourceConfig = {
  /** The source namespace, e.g. `youtube.codebluecam`. */
  namespace: string;
  /** Display name stored on the coverage link, e.g. `Code Blue Cam`. */
  sourceName: string;
  /** The channel's mutable handle, e.g. `@CodeBlueCam`. */
  channelHandle: string;
  /**
   * The channel's immutable id. Pinned, not discovered: a handle can be renamed
   * or transferred to a different channel, and a silently repointed source would
   * publish another publisher's claims about named officers under this one's
   * name. Acquire resolves the handle and refuses to run on a mismatch.
   */
  channelId: string;
  /** How the pinned channel id was verified, for the run log and review. */
  channelIdProvenance: string;
};

/** The inclusive start of the rolling window ending at `now`. */
export function rollingWindowStart(now: Date): Date {
  const start = new Date(now.getTime());
  start.setUTCFullYear(start.getUTCFullYear() - ROLLING_WINDOW_YEARS);
  return start;
}

/** True when `publishedAt` falls inside the window `[startAt, endAt]`. */
export function inWindow(
  publishedAt: string,
  window: { startAt: string; endAt: string },
): boolean {
  const at = Date.parse(publishedAt);
  const start = Date.parse(window.startAt);
  const end = Date.parse(window.endAt);
  if (Number.isNaN(at) || Number.isNaN(start) || Number.isNaN(end))
    return false;
  return at >= start && at <= end;
}

export function canonicalVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Canonicalize a video URL for `coverage_links.normalized_url`, which carries a
 * UNIQUE index.
 *
 * Only the scheme and host are lowercased. YouTube video ids are case-sensitive
 * base64url (`dQw4w9WgXcQ` ≠ `dqw4w9wgxcq`), so case-folding the whole URL can
 * map two distinct videos onto one normalized key — under a unique index that
 * means one video silently blocks the other, or officer links land on the wrong
 * video. Accuracy over tidiness: the query string is preserved verbatim.
 */
export function normalizeVideoUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  const split = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]+)(.*)$/.exec(trimmed);
  return split === null
    ? trimmed
    : `${split[1].toLowerCase()}${split[2] ?? ""}`;
}

// A named officer the publisher asserts, and the passage asserting it. Names are
// only ever CANDIDATES — the intake-owned resolver gates them against the agency
// roster (confidence floor + ambiguity band); we never guess (#52).
// The role prefix is case-insensitive (`(?i:…)`) so "Officer"/"OFFICER"/"officer"
// all match; the name stays Title-case so only capitalized name words are
// captured (it stops at the next lowercase word, e.g. "responds").
const OFFICER_MENTION =
  /\b(?i:officers?|deputies|deputy|sergeants?|sgt|detectives?|det|lieutenants?|lt|corporals?|cpl|troopers?|chiefs?|captains?|capt|sheriffs?|marshals?|patrol(?:man|woman|men)?)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,2})/g;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The distinct officer mentions in a video, each with its first supporting
 * passage across the title, description, and captions.
 */
export function officerMentions(
  video: Pick<AcquiredVideo, "title" | "description" | "captions">,
): Array<{ name: string; passage: string }> {
  const found = new Map<string, string>();
  for (const field of [video.title, video.description, video.captions ?? ""]) {
    for (const match of field.matchAll(OFFICER_MENTION)) {
      const name = match[1].trim();
      if (!isPersonName(name) || found.has(name)) continue;
      found.set(name, match[0].trim());
    }
  }
  return [...found].map(([name, passage]) => ({ name, passage }));
}

/**
 * The provenance line stored with a link. `coverage_links` has no column for a
 * channel id or a retrieval time (its spec is `.strict()`), so the structured
 * record of both stays in the acquire envelope and this human-readable line
 * travels with the published row. The publisher's own framing is kept above it,
 * separated, because that text is an attributed claim and not a fact (#52).
 */
export function provenanceNote(
  config: ChannelSourceConfig,
  video: AcquiredVideo,
): string {
  const claim = text(video.description);
  const provenance = [
    `${config.sourceName} (YouTube channel ${config.channelId})`,
    `video ${video.videoId}`,
    `published ${text(video.publishedAt)}`,
    `retrieved ${text(video.retrievedAt)}`,
    canonicalVideoUrl(video.videoId),
  ].join("; ");
  return claim === ""
    ? `Source provenance — ${provenance}`
    : `${claim}\n\nSource provenance — ${provenance}`;
}

/** What acquire writes per agency; the only input transform reads. */
export type VideoEnvelope = {
  agency: {
    id?: string;
    name?: string;
    state?: string;
    county?: string;
    place?: string;
  };
  channel?: { handle?: string; channelId?: string };
  /** The rolling window the acquire run used; transform filters against it. */
  window?: { startAt?: string; endAt?: string };
  videos?: AcquiredVideo[];
};

const envelopeSuffix = ".videos.json";

export function createChannelAcquire(
  config: ChannelSourceConfig,
): SourceAcquire {
  return async ({ sourceDir, state, env, data, logger }: AcquireDeps) => {
    const log = logger ?? { info() {} };
    const apiKey = env.YOUTUBE_API_KEY;
    if (apiKey === undefined || apiKey.trim() === "") {
      throw new Error(
        `${config.namespace}: YOUTUBE_API_KEY is required to search the channel.`,
      );
    }
    await mkdir(sourceDir, { recursive: true });
    const apiLogPath = path.join(sourceDir, ".api-calls.jsonl");

    const fetchJson = async (url: string): Promise<Record<string, unknown>> => {
      const keyed = `${url}${url.includes("?") ? "&" : "?"}key=${apiKey}`;
      for (let attempt = 0; ; attempt += 1) {
        const response = await fetch(keyed);
        const body = await parseBody(response);
        await appendFile(
          // codeql[js/http-to-file-access] This fixed JSONL file preserves the source response for audit; downstream transforms parse JSON and never execute it.
          apiLogPath,
          `${JSON.stringify({ at: new Date().toISOString(), url, status: response.status, body })}\n`,
        );
        if (response.ok) return body as Record<string, unknown>;
        if (isQuotaExhaustedBody(body)) {
          throw new YoutubeQuotaError(
            `${config.namespace}: YouTube quota exhausted (${response.status}); ${quotaResetHint(body, new Date())}. Stopping (resumes next run).`,
          );
        }
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= MAX_RETRIES) {
          throw new Error(`${config.namespace}: ${response.status} for ${url}`);
        }
        const waitMs = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
        log.info(
          `${config.namespace}: ${response.status}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES}).`,
        );
        await sleep(waitMs);
      }
    };
    const fetchText = async (url: string): Promise<string> => {
      const response = await fetch(url);
      return response.ok ? response.text() : "";
    };

    const youtube = createYoutubeApi({ fetchJson, fetchText });
    const resolved = await youtube.resolveChannelId(config.channelHandle);
    if (resolved === null) {
      throw new Error(
        `${config.namespace}: could not resolve channel id for ${config.channelHandle}.`,
      );
    }
    // A handle is mutable; the pinned id is the source's identity. Refuse rather
    // than ingest a different channel's videos under this source's name.
    if (resolved !== config.channelId) {
      throw new Error(
        `${config.namespace}: ${config.channelHandle} now resolves to channel ${resolved}, ` +
          `but this source is pinned to ${config.channelId} (${config.channelIdProvenance}). ` +
          `Refusing to ingest: the handle may have been renamed or transferred. ` +
          `Re-verify the channel and update the pin before running.`,
      );
    }
    const channelId = config.channelId;

    const now = new Date();
    const nowIso = now.toISOString();
    const window = {
      startAt: rollingWindowStart(now).toISOString(),
      endAt: nowIso,
    };
    await writeFile(
      path.join(sourceDir, "channel.json"),
      `${JSON.stringify(
        {
          handle: config.channelHandle,
          channelId,
          channelIdProvenance: config.channelIdProvenance,
          resolvedAt: nowIso,
          window,
          rollingWindowYears: ROLLING_WINDOW_YEARS,
        },
        null,
        2,
      )}\n`,
    );

    // Year buckets keep one search call per agency per run while still covering
    // the window: the open (current) year is refreshed on a cadence, older years
    // are backfilled newest-first down to the window's floor year.
    const currentYear = now.getUTCFullYear();
    const floorYear = rollingWindowStart(now).getUTCFullYear();
    const refreshDays = Number(
      env.YOUTUBE_REFRESH_DAYS ?? String(DEFAULT_REFRESH_DAYS),
    );

    const cache = await loadVideoCache(state);
    let searched = 0;
    let upToDate = 0;
    let failed = 0;

    const processAgency = async (
      agencyId: string,
      agencyName: string,
      agencyState: string,
      place: string,
      county: string,
    ): Promise<void> => {
      if (agencyName === "") return;
      const slug = slugify(agencyName);
      const entry = pruneYearsBefore(
        cache.agencies[slug] ?? { years: {} },
        floorYear,
      );

      const year = planYearToAcquire(entry, {
        floorYear,
        currentYear,
        now,
        refreshDays,
      });
      if (year === null) {
        upToDate += 1;
      } else {
        // Clamp the oldest bucket to the window's real start; the window only
        // moves forward, so nothing clamped out can re-enter it later.
        const bucketStart = new Date(Date.UTC(year, 0, 1)).toISOString();
        try {
          const hits = await youtube.searchChannelVideos(
            channelId,
            agencyQuery(agencyName, place),
            {
              publishedAfter:
                bucketStart < window.startAt ? window.startAt : bucketStart,
              publishedBefore: new Date(Date.UTC(year + 1, 0, 1)).toISOString(),
            },
          );
          const videos: AcquiredVideo[] = [];
          for (const hit of hits) {
            videos.push({
              ...hit,
              url: canonicalVideoUrl(hit.videoId),
              retrievedAt: nowIso,
              captions: await youtube.fetchCaptions(hit.videoId),
            });
          }
          entry.years[String(year)] = { searchedAt: nowIso, videos };
          cache.agencies[slug] = entry;
          await saveVideoCache(state, cache);
          searched += 1;
          log.info(
            `${config.namespace}: ${agencyName} ${year} — ${videos.length} video(s) [searched ${searched}]`,
          );
          await sleep(POLITE_DELAY_MS);
        } catch (error) {
          // Quota exhausted halts the whole run (every later call would 403 too);
          // any other single-agency failure is logged and skipped, uncached so a
          // later run retries it.
          if (error instanceof YoutubeQuotaError) throw error;
          failed += 1;
          log.info(
            `${config.namespace}: ${agencyName} ${year} — search failed, skipped (${error instanceof Error ? error.message : String(error)}).`,
          );
          return;
        }
      }

      cache.agencies[slug] = entry;
      // Written every run, even when nothing was searched: the envelope carries
      // the CURRENT window, so transform re-evaluates every cached video against
      // it — that is what re-considers a previously skipped in-window video.
      await writeFile(
        path.join(sourceDir, `${slug}${envelopeSuffix}`),
        `${JSON.stringify(
          {
            agency: {
              id: agencyId,
              name: agencyName,
              state: agencyState,
              county,
              place,
            },
            channel: {
              handle: config.channelHandle,
              channelId,
            },
            window,
            videos: mergedVideos(entry),
          },
          null,
          2,
        )}\n`,
      );
    };

    let quotaHit = false;
    try {
      let cursor: string | undefined;
      do {
        const page = await data.agencies({ minOfficers: 1, cursor, limit: 50 });
        for (const record of page.items) {
          await processAgency(
            record.agencyId,
            record.name.trim(),
            record.state,
            record.place ?? "",
            record.county ?? "",
          );
        }
        cursor = page.nextCursor;
      } while (cursor !== undefined);
    } catch (error) {
      if (!(error instanceof YoutubeQuotaError)) throw error;
      quotaHit = true;
      log.info(error.message);
    }

    await saveVideoCache(state, cache);
    log.info(
      `${config.namespace}: channel ${channelId}; window ${window.startAt} … ${window.endAt}; ` +
        `${searched} agency-years searched, ${upToDate} already current, ${failed} skipped after errors` +
        `${quotaHit ? ", stopped on quota" : ""}. state=${state}`,
    );
  };
}

export function createChannelTransform(config: ChannelSourceConfig): {
  produces: readonly ImportArtifactKind[];
  transform: SourceTransform;
} {
  const transform: SourceTransform = async ({
    paths,
    data,
    logger,
  }: TransformDeps) => {
    const log = logger ?? { info() {} };
    if (data === undefined) {
      throw new Error(
        `${config.namespace}: transform requires a data context (DATABASE_URL) to resolve officers (ADR 0023).`,
      );
    }
    const direct = paths.filter((p) => p.endsWith(envelopeSuffix));
    const files =
      direct.length > 0 ? direct : await collectEnvelopePaths(paths);

    const coverageLinks: EmittedRecords = {};
    const coverageLinkAgencyPersonnel: EmittedRecords = {};
    let outOfWindow = 0;
    let unmatched = 0;

    for (const file of files.slice().sort()) {
      const envelope = JSON.parse(
        await readFile(file, "utf8"),
      ) as VideoEnvelope;
      const agencyId = text(envelope.agency.id);
      const agencyName = text(envelope.agency.name);
      // The agency comes from the acquire facade, so it is already in the
      // database by construction — a video never mints one.
      if (agencyId === "" || agencyName === "") continue;

      const startAt = text(envelope.window?.startAt);
      const endAt = text(envelope.window?.endAt);
      if (startAt === "" || endAt === "") {
        throw new Error(
          `${config.namespace}: ${path.basename(file)} has no acquire window; ` +
            `re-run acquire (the rolling ${ROLLING_WINDOW_YEARS}-year window is recorded there, not inferred here).`,
        );
      }
      const window = { startAt, endAt };
      const envelopeChannelId = text(envelope.channel?.channelId);
      if (envelopeChannelId !== "" && envelopeChannelId !== config.channelId) {
        throw new Error(
          `${config.namespace}: ${path.basename(file)} was acquired from channel ` +
            `${envelopeChannelId}, not the pinned ${config.channelId}.`,
        );
      }

      for (const video of envelope.videos ?? []) {
        const videoId = text(video.videoId);
        const title = text(video.title);
        const publishedAt = text(video.publishedAt);
        if (videoId === "" || title === "" || publishedAt === "") continue;

        // Out of the rolling window: not a link this run, and not an error.
        if (!inWindow(publishedAt, window)) {
          outOfWindow += 1;
          continue;
        }

        // Resolve every officer the video names AT THIS AGENCY (the agency is
        // fixed by acquire). A name resolving to no existing officer, or
        // ambiguously, yields no link — never a guess, never a new record. The
        // skip is not recorded, so a later run with the officer present links it.
        const resolved = new Map<string, string>();
        for (const mention of officerMentions(video)) {
          const match = await data.resolvePersonnel({
            agencyId,
            personnelName: mention.name,
          });
          if (match !== null && !resolved.has(match.agencyPersonnelId)) {
            resolved.set(match.agencyPersonnelId, mention.passage);
          }
        }
        if (resolved.size === 0) {
          unmatched += 1;
          continue;
        }

        const url = canonicalVideoUrl(videoId);
        const publishedDate = publishedAt.slice(0, 10);
        coverageLinks[videoId] = {
          spec: {
            url,
            normalized_url: normalizeVideoUrl(url),
            title,
            source_name: config.sourceName,
            // `coverage_links.published_at` is a date column; the full
            // publication timestamp is preserved in the provenance note and the
            // acquire envelope.
            published_at: /^\d{4}-\d{2}-\d{2}$/.test(publishedDate)
              ? publishedDate
              : null,
            notes: provenanceNote(config, { ...video, videoId, publishedAt }),
          },
        };
        for (const [agencyPersonnelId, passage] of resolved) {
          coverageLinkAgencyPersonnel[`${videoId}|${agencyPersonnelId}`] = {
            spec: {
              coverage_link_id: videoId,
              agency_personnel_id: agencyPersonnelId,
              confidence: "named-in-video",
              notes: passage,
            },
          };
        }
      }
    }

    log.info(
      `${config.namespace}: ${Object.keys(coverageLinks).length} in-window videos with a resolved officer, ` +
        `${Object.keys(coverageLinkAgencyPersonnel).length} video-officer links, ` +
        `${outOfWindow} outside the rolling ${ROLLING_WINDOW_YEARS}-year window, ` +
        `${unmatched} in-window with no definitive officer match (retried next run)`,
    );

    return {
      artifacts: [
        { kind: "CoverageLinks", records: coverageLinks },
        {
          kind: "CoverageLinkAgencyPersonnel",
          records: coverageLinkAgencyPersonnel,
        },
      ],
    };
  };

  return {
    produces: ["CoverageLinks", "CoverageLinkAgencyPersonnel"],
    transform,
  };
}

function agencyQuery(name: string, place: string): string {
  return [name, place]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function parseBody(response: Response): Promise<unknown> {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function collectEnvelopePaths(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const base of paths) {
    try {
      for (const entry of await readdir(base)) {
        if (entry.endsWith(envelopeSuffix)) files.push(path.join(base, entry));
      }
    } catch {
      // A non-directory path is not an envelope root; skip it.
    }
  }
  return files;
}
