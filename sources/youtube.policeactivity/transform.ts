import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  EmittedRecords,
  TransformDeps,
  SourceTransform,
} from "../../src/cli/transform/source-transform.js";
import { isPersonName } from "../lib/civil-defendants.js";
import { isWithinWindow } from "../lib/rolling-window.js";
import { SOURCE_ID } from "./channel.js";
import type { AcquiredVideo } from "./video-cache.js";
import {
  ENVELOPE_SUFFIX,
  readVideoEnvelope,
  type VideoEnvelope,
} from "./video-envelope.js";

export const produces: readonly ImportArtifactKind[] = [
  "CoverageLinks",
  "CoverageLinkAgencyPersonnel",
];

export const description =
  "PoliceActivity (YouTube) — videos found by searching the channel per agency, linked to any officer at that agency the video names (resolved via the fuzzy agency_personnel resolver, ADR 0022/0023). The channel's framing is an attributed claim; only the resolved officer link is a fact, cited to the naming passage. Each run considers only the rolling five-year window its evidence was acquired under.";

// A named officer the publisher asserts, and the passage asserting it. Names are
// only ever CANDIDATES — the intake-owned resolver gates them against the agency
// roster (confidence floor + ambiguity band); we never guess (#52).
// The role prefix is case-insensitive (`(?i:…)`) so "Officer"/"OFFICER"/"officer"
// all match; the name stays Title-case so only capitalized name words are
// captured (it stops at the next lowercase word, e.g. "responds").
const OFFICER_MENTION =
  /\b(?i:officers?|deputies|deputy|sergeants?|sgt|detectives?|det|lieutenants?|lt|corporals?|cpl|troopers?|chiefs?|captains?|capt|sheriffs?|marshals?|patrol(?:man|woman|men)?)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,2})/g;

// The distinct officer mentions in a video, each with its first supporting
// passage across the title and description. Captions are not a source:
// youtube.com/robots.txt disallows /api/, where the timedtext track lives.
function officerMentions(
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

function normalizedUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

// The videos this run considers: the ones the evidence's own rolling window
// covers. The window travels on the envelope, so this stays deterministic — the
// produce phase never reads the clock.
function consideredVideos(envelope: VideoEnvelope): AcquiredVideo[] {
  return envelope.videos.filter((video) =>
    isWithinWindow(video.publishedAt, envelope.window),
  );
}

export const transform: SourceTransform = async ({
  paths,
  data,
  logger,
}: TransformDeps) => {
  const log = logger ?? { info() {} };
  if (data === undefined) {
    throw new Error(
      `${SOURCE_ID}: run requires a data context (DATABASE_URL) to resolve officers (ADR 0023).`,
    );
  }
  const envelopePaths = paths.filter((p) => p.endsWith(ENVELOPE_SUFFIX));
  const files =
    envelopePaths.length > 0
      ? envelopePaths
      : await collectEnvelopePaths(paths);

  const coverageLinks: EmittedRecords = {};
  const coverageLinkAgencyPersonnel: EmittedRecords = {};
  let considered = 0;
  let outOfWindow = 0;
  let untitled = 0;
  let unmatched = 0;

  for (const file of files) {
    const envelope = await readVideoEnvelope(file);
    const agencyId = envelope.agency.id;
    const videos = consideredVideos(envelope);
    outOfWindow += envelope.videos.length - videos.length;

    for (const video of videos) {
      considered += 1;
      if (video.title.trim() === "") {
        // No title means no renderable coverage link; visible, not silent.
        untitled += 1;
        continue;
      }

      // Resolve every officer the video names AT THIS AGENCY (the agency is fixed
      // by acquire). A name resolving to no existing officer, or ambiguously,
      // yields no link — never a guess, never a new record.
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
        // Skipped for this run only: the video stays in the evidence and is
        // reconsidered on every later run while it is in the window, so it
        // becomes a link once the officer and agency exist.
        unmatched += 1;
        continue;
      }

      const publishedAt = video.publishedAt.slice(0, 10);
      coverageLinks[video.videoId] = {
        spec: {
          url: video.url,
          normalized_url: normalizedUrl(video.url),
          title: video.title.trim(),
          source_name: envelope.source.name,
          published_at: /^\d{4}-\d{2}-\d{2}$/.test(publishedAt)
            ? publishedAt
            : null,
          // The publisher's framing, kept as an attributed claim (#52).
          notes: video.description.trim() || null,
        },
      };
      for (const [agencyPersonnelId, passage] of resolved) {
        coverageLinkAgencyPersonnel[`${video.videoId}|${agencyPersonnelId}`] = {
          spec: {
            coverage_link_id: video.videoId,
            agency_personnel_id: agencyPersonnelId,
            confidence: "named-in-video",
            notes: passage,
          },
        };
      }
    }
  }

  log.info(
    `${SOURCE_ID}: ${considered} in-window video(s) considered — ` +
      `${Object.keys(coverageLinks).length} with a resolved officer, ` +
      `${Object.keys(coverageLinkAgencyPersonnel).length} video-officer link(s); ` +
      `${unmatched} unmatched (retried next run), ${untitled} untitled, ` +
      `${outOfWindow} outside the acquired window`,
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

async function collectEnvelopePaths(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const base of paths) {
    try {
      for (const entry of await readdir(base)) {
        if (entry.endsWith(ENVELOPE_SUFFIX)) files.push(path.join(base, entry));
      }
    } catch {
      // A non-directory path is not an envelope root; skip it.
    }
  }
  return files;
}
