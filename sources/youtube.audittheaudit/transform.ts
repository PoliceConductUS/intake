import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  EmittedRecords,
  TransformDeps,
  SourceTransform,
} from "../../src/cli/transform/source-transform.js";
import { officerMentions } from "../lib/officer-mentions.js";
import { CHANNEL_ID, SOURCE_ID, SOURCE_NAME } from "./channel.js";
import { isInWindow, type RollingWindow } from "./rolling-window.js";
import type { AcquiredVideo } from "./video-cache.js";

export const produces: readonly ImportArtifactKind[] = [
  "CoverageLinks",
  "CoverageLinkAgencyPersonnel",
];

export const description =
  "Audit the Audit (YouTube) — links to channel videos published inside the rolling five-year window acquire recorded, each linked to an officer the video names who already exists at the agency the video was acquired for (resolved via the fuzzy agency_personnel resolver, ADR 0022/0023). The channel's framing is an attributed claim; only the resolved officer link is a fact, cited to the naming passage. No officer or agency is ever created from a video.";

type VideoEnvelope = {
  agency?: { id?: string; name?: string; state?: string };
  channel?: { id?: string; handle?: string };
  window?: { startsAt?: string; endsAt?: string };
  retrievedAt?: string;
  videos?: AcquiredVideo[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

// The evidence a link rests on has to be complete before anything is emitted: an
// envelope without its agency, channel, or window cannot be checked, so it fails
// the run instead of producing an unverifiable link.
function requireEnvelope(
  file: string,
  envelope: VideoEnvelope,
): { agencyId: string; agencyName: string; window: RollingWindow } {
  const agencyId = text(envelope.agency?.id);
  const agencyName = text(envelope.agency?.name);
  const channelId = text(envelope.channel?.id);
  const startsAt = text(envelope.window?.startsAt);
  const endsAt = text(envelope.window?.endsAt);
  if (agencyId === "" || agencyName === "") {
    throw new Error(`${SOURCE_ID}: ${file} has no acquired agency.`);
  }
  if (channelId !== CHANNEL_ID) {
    throw new Error(
      `${SOURCE_ID}: ${file} was acquired from channel ${channelId === "" ? "(none)" : channelId}, not ${CHANNEL_ID}.`,
    );
  }
  if (startsAt === "" || endsAt === "") {
    throw new Error(
      `${SOURCE_ID}: ${file} records no acquisition window; the five-year period cannot be applied.`,
    );
  }
  return { agencyId, agencyName, window: { startsAt, endsAt } };
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
  const envelopePaths = paths.filter((p) => p.endsWith(".videos.json"));
  const files =
    envelopePaths.length > 0
      ? envelopePaths
      : await collectEnvelopePaths(paths);

  const coverageLinks: EmittedRecords = {};
  const coverageLinkAgencyPersonnel: EmittedRecords = {};
  let outOfWindow = 0;
  let unmatched = 0;

  for (const file of files) {
    const envelope = JSON.parse(await readFile(file, "utf8")) as VideoEnvelope;
    const { agencyId, window } = requireEnvelope(file, envelope);

    for (const video of envelope.videos ?? []) {
      const videoId = text(video.videoId);
      const url = text(video.url);
      const title = text(video.title);
      const publishedAt = text(video.publishedAt);
      if (videoId === "" || url === "" || title === "") continue;
      if (text(video.channelId) !== CHANNEL_ID) {
        throw new Error(
          `${SOURCE_ID}: ${file} holds video ${videoId} from channel ${text(video.channelId) || "(none)"}, not ${CHANNEL_ID}.`,
        );
      }
      // Only the rolling period the evidence was acquired for qualifies; a video
      // the window has rolled past stops producing a link without being deleted.
      if (!isInWindow(publishedAt, window)) {
        outOfWindow += 1;
        continue;
      }

      // Resolve every officer the video names AT THIS AGENCY (the agency is fixed
      // by acquire and already exists in the database). A name resolving to no
      // existing officer, or ambiguously, yields no link — never a guess, never a
      // new record. The video stays in the acquired evidence, so a later run
      // picks it up once the officer exists.
      const resolved = new Map<string, string>();
      for (const mention of officerMentions([title, text(video.description)])) {
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

      coverageLinks[videoId] = {
        spec: {
          url,
          normalized_url: normalizedUrl(url),
          title,
          source_name: SOURCE_NAME,
          // In-window implies a parseable instant; the full timestamp, channel
          // id, and retrieval time stay in the acquired evidence envelope.
          published_at: new Date(Date.parse(publishedAt))
            .toISOString()
            .slice(0, 10),
          // The publisher's framing, kept as an attributed claim (#52).
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
    `${SOURCE_ID}: ${Object.keys(coverageLinks).length} in-window video(s) with a resolved officer, ` +
      `${Object.keys(coverageLinkAgencyPersonnel).length} video-officer link(s), ` +
      `${unmatched} in-window video(s) skipped with no definite officer match (reconsidered next run), ` +
      `${outOfWindow} outside the window`,
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
        if (entry.endsWith(".videos.json")) files.push(path.join(base, entry));
      }
    } catch {
      // A non-directory path is not an envelope root; skip it.
    }
  }
  return files;
}
