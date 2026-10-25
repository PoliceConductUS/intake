// A YouTube channel coverage source, as behavior shared by every channel the
// board queues. The channels differ only in which channel they are, so the
// difference is a `ChannelSourceConfig` and each `sources/<namespace>/` is the
// configuration naming one channel. Nothing here branches on the namespace.
//
// What a channel source does: search the channel, per agency we already have,
// inside a rolling publication window; keep only videos that name an officer who
// already exists at that agency; emit a link to the video, citing the passage
// that names the officer. It never ingests video media, and never creates an
// agency or an officer.

import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  AcquireDeps,
  AcquireAgencyRecord,
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
  isInWindow,
  lastSearchedAt,
  loadChannelCache,
  mergedVideos,
  nextYearToAcquire,
  rollingWindow,
  saveChannelCache,
  searchBounds,
  windowYearRange,
  type AcquiredVideo,
  type PublicationWindow,
} from "./youtube-channel-cache.js";

/** The whole difference between one channel coverage source and another. */
export type ChannelSourceConfig = {
  /** Source namespace. Used only to prefix log lines and error messages. */
  namespace: string;
  /**
   * The channel's immutable YouTube channel id (`UC…`). This, not the handle, is
   * the source's identity: a handle can be renamed or transferred to a different
   * channel, silently re-pointing the source at someone else's videos.
   */
  channelId: string;
  /** Public handle, recorded as provenance only. Never used to select. */
  handle: string;
  /** `source_name` stamped on every emitted CoverageLink. */
  sourceName: string;
  /** Length of the rolling publication window, in years, ending at the run. */
  windowYears: number;
};

export const CHANNEL_SOURCE_PRODUCES: readonly ImportArtifactKind[] = [
  "CoverageLinks",
  "CoverageLinkAgencyPersonnel",
];

const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 60_000;
// Be gentle: a small pause between agency searches (we are in no rush).
const POLITE_DELAY_MS = 250;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** The envelope acquire writes per agency and transform reads back. */
export type VideoEnvelope = {
  agency: {
    id?: string;
    name?: string;
    state?: string;
    county?: string;
    place?: string;
  };
  channelId: string;
  handle: string;
  window: PublicationWindow;
  retrievedAt: string;
  videos?: AcquiredVideo[];
};

function agencyQuery(name: string, place: string): string {
  return [name, place]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

// Candidates come from the video's TITLE and DESCRIPTION only. Captions are off
// limits: youtube.com/robots.txt carries `Disallow: /api/`, and the only
// third-party transcript path is `youtube.com/api/timedtext`, inside that
// prefix. The Data API's `captions.download` needs OAuth as the channel owner,
// so there is no sanctioned transcript route for someone else's channel at all.
// That costs real recall — a name is most often spoken rather than written — and
// we take the loss. Do not reintroduce a caption fetch or a scraping library.
//
// A named officer the publisher asserts, and the passage asserting it. Names are
// only ever CANDIDATES — the intake-owned resolver gates them against the agency
// roster (confidence floor + ambiguity band); we never guess.
// The role prefix is case-insensitive (`(?i:…)`) so "Officer"/"OFFICER"/"officer"
// all match; the name stays Title-case so only capitalized name words are
// captured (it stops at the next lowercase word, e.g. "responds").
const OFFICER_MENTION =
  /\b(?i:officers?|deputies|deputy|sergeants?|sgt|detectives?|det|lieutenants?|lt|corporals?|cpl|troopers?|chiefs?|captains?|capt|sheriffs?|marshals?|patrol(?:man|woman|men)?)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,2})/g;

/**
 * The distinct officer mentions in a video, each with its first supporting
 * passage across the title, description, and captions.
 */
export function officerMentions(
  video: AcquiredVideo,
): Array<{ name: string; passage: string }> {
  const found = new Map<string, string>();
  for (const field of [video.title, video.description]) {
    for (const match of field.matchAll(OFFICER_MENTION)) {
      const name = match[1].trim();
      if (!isPersonName(name) || found.has(name)) continue;
      found.set(name, match[0].trim());
    }
  }
  return [...found].map(([name, passage]) => ({ name, passage }));
}

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
    // `fetchText` is required by the client's constructor but is only used by
    // its caption fetch, which we never call — see the captions note above.
    const fetchText = async (): Promise<string> => "";

    const youtube = createYoutubeApi({ fetchJson, fetchText });

    // Verify the PINNED channel id, never resolve one from the handle. A handle
    // can be renamed or transferred to a different channel, which would silently
    // re-point this source at someone else's videos; an id cannot. The handle and
    // title the API returns are recorded as provenance and logged on drift.
    const channelId = config.channelId;
    const verified = await fetchJson(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${encodeURIComponent(channelId)}`,
    );
    const channel = (Array.isArray(verified.items) ? verified.items : [])[0] as
      | { snippet?: { title?: unknown; customUrl?: unknown } }
      | undefined;
    if (channel === undefined) {
      throw new Error(
        `${config.namespace}: channel id ${channelId} returned no channel; refusing to run against an unverified channel.`,
      );
    }
    const liveTitle = text(channel.snippet?.title);
    const liveHandle = text(channel.snippet?.customUrl);
    if (
      liveHandle !== "" &&
      liveHandle.replace(/^@/, "").toLowerCase() !==
        config.handle.replace(/^@/, "").toLowerCase()
    ) {
      log.info(
        `${config.namespace}: handle drift — config says ${config.handle}, channel ${channelId} now reports ${liveHandle}. Selecting by id regardless; update the config's provenance.`,
      );
    }

    const runAt = new Date();
    const retrievedAt = runAt.toISOString();
    const window = rollingWindow(runAt, config.windowYears);
    const { floorYear, newestYear } = windowYearRange(window);

    await writeFile(
      path.join(sourceDir, "channel.json"),
      JSON.stringify(
        {
          channelId,
          handle: config.handle,
          liveHandle,
          liveTitle,
          window,
          retrievedAt,
        },
        null,
        2,
      ),
    );

    const cache = await loadChannelCache(state);

    // Collect every agency before searching so the run can order them
    // stalest-first. A run halts on exhausted quota, so a cursor-ordered loop
    // would re-search the head every run and never reach the tail.
    const agencies: AcquireAgencyRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await data.agencies({ minOfficers: 1, cursor, limit: 50 });
      agencies.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    const ordered = agencies
      .filter((record) => record.name.trim() !== "")
      .map((record) => ({
        record,
        staleness: lastSearchedAt(cache.agencies[record.agencyId]),
      }))
      .sort(
        (left, right) =>
          left.staleness.localeCompare(right.staleness) ||
          left.record.agencyId.localeCompare(right.record.agencyId),
      )
      .map((entry) => entry.record);

    // A slug collision would silently overwrite another agency's envelope, so it
    // fails the run instead.
    const envelopeNames = new Map<string, string>();
    const envelopeNameFor = (agencyId: string): string => {
      const name = `${slugify(agencyId)}.videos.json`;
      const owner = envelopeNames.get(name);
      if (owner !== undefined && owner !== agencyId) {
        throw new Error(
          `${config.namespace}: agencies ${owner} and ${agencyId} both slug to ${name}.`,
        );
      }
      envelopeNames.set(name, agencyId);
      return name;
    };

    let searched = 0;
    let failed = 0;

    const processAgency = async (
      record: AcquireAgencyRecord,
    ): Promise<void> => {
      const agencyName = record.name.trim();
      const entry = cache.agencies[record.agencyId] ?? { years: {} };
      const year = nextYearToAcquire(entry, floorYear, newestYear);

      try {
        const hits = await youtube.searchChannelVideos(
          channelId,
          agencyQuery(agencyName, record.place ?? ""),
          searchBounds(year, window),
        );
        const videos: AcquiredVideo[] = hits.map((hit) => ({
          ...hit,
          retrievedAt,
        }));
        entry.years[String(year)] = { searchedAt: retrievedAt, videos };
        cache.agencies[record.agencyId] = entry;
        await saveChannelCache(state, cache);
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
    };

    const writeEnvelope = async (
      record: AcquireAgencyRecord,
    ): Promise<void> => {
      const entry = cache.agencies[record.agencyId];
      if (entry === undefined) return;
      const envelope: VideoEnvelope = {
        agency: {
          id: record.agencyId,
          name: record.name.trim(),
          state: record.state,
          county: record.county ?? "",
          place: record.place ?? "",
        },
        channelId,
        handle: config.handle,
        window,
        retrievedAt,
        videos: mergedVideos(entry),
      };
      await writeFile(
        path.join(sourceDir, envelopeNameFor(record.agencyId)),
        JSON.stringify(envelope, null, 2),
      );
    };

    let quotaHit = false;
    try {
      for (const record of ordered) {
        await processAgency(record);
      }
    } catch (error) {
      if (!(error instanceof YoutubeQuotaError)) throw error;
      quotaHit = true;
      log.info(error.message);
    }

    // Every agency with cached evidence gets an envelope, including the ones this
    // run did not reach — their already-acquired videos must still be
    // reconsidered by the transform while they remain in window.
    for (const record of ordered) {
      await writeEnvelope(record);
    }

    log.info(
      `${config.namespace}: ${searched} agency-year(s) searched of ${ordered.length} agencies, ` +
        `${failed} skipped after errors${quotaHit ? ", stopped on quota" : ""}. ` +
        `window ${window.start}..${window.end}, state=${state}`,
    );
  };
}

export function createChannelTransform(
  config: ChannelSourceConfig,
): SourceTransform {
  return async ({ paths, data, logger }: TransformDeps) => {
    const log = logger ?? { info() {} };
    if (data === undefined) {
      throw new Error(
        `${config.namespace}: run requires a data context (DATABASE_URL) to resolve officers (ADR 0023).`,
      );
    }
    const envelopePaths = paths.filter((p) => p.endsWith(".videos.json"));
    const files =
      envelopePaths.length > 0
        ? envelopePaths
        : await collectEnvelopePaths(paths);

    const coverageLinks: EmittedRecords = {};
    const coverageLinkAgencyPersonnel: EmittedRecords = {};
    let outOfWindow = 0;
    let wrongChannel = 0;

    for (const file of files.slice().sort()) {
      const envelope = JSON.parse(
        await readFile(file, "utf8"),
      ) as VideoEnvelope;
      const agencyId = text(envelope.agency.id);
      const agencyName = text(envelope.agency.name);
      if (agencyId === "" || agencyName === "") continue;
      // The window the evidence was gathered under, so the transform stays
      // deterministic and a replay reproduces the run it replays.
      const window = envelope.window;
      if (
        window === undefined ||
        Number.isNaN(Date.parse(window.start)) ||
        Number.isNaN(Date.parse(window.end))
      ) {
        throw new Error(
          `${config.namespace}: ${file} has no usable publication window; re-acquire the source.`,
        );
      }

      for (const video of envelope.videos ?? []) {
        const videoId = text(video.videoId);
        const url = text(video.url);
        const title = text(video.title);
        if (videoId === "" || url === "" || title === "") continue;

        // Re-verify the channel on the evidence itself, so the guarantee holds
        // on a replay where acquire never ran. A video from another channel must
        // not be attributed to this source.
        if (text(video.channelId) !== config.channelId) {
          wrongChannel += 1;
          continue;
        }

        // The rolling window is enforced here, not only at search time: the
        // acquired cache outlives the window it was fetched under, so a video
        // that has since aged out must stop producing links.
        if (!isInWindow(video.publishedAt, window)) {
          outOfWindow += 1;
          continue;
        }

        // Resolve every officer the video names AT THIS AGENCY (the agency is
        // fixed by acquire and already exists in the database). A name resolving
        // to no existing officer, or ambiguously, yields no link — never a
        // guess, never a new record.
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
        if (resolved.size === 0) continue;

        const publishedAt = text(video.publishedAt).slice(0, 10);
        coverageLinks[videoId] = {
          spec: {
            url,
            normalized_url: normalizedUrl(url),
            title,
            source_name: config.sourceName,
            published_at: /^\d{4}-\d{2}-\d{2}$/.test(publishedAt)
              ? publishedAt
              : null,
            // The publisher's framing, kept as an attributed claim.
            notes: text(video.description) || null,
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
      `${config.namespace}: ${Object.keys(coverageLinks).length} videos with a resolved officer, ` +
        `${Object.keys(coverageLinkAgencyPersonnel).length} video-officer links, ` +
        `${outOfWindow} skipped as out of window, ` +
        `${wrongChannel} skipped as not from channel ${config.channelId}`,
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
}

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
        if (entry.endsWith(".videos.json")) files.push(path.join(base, entry));
      }
    } catch {
      // A non-directory path is not an envelope root; skip it.
    }
  }
  return files;
}
