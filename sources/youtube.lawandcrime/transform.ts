import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  EmittedRecords,
  TransformDeps,
  SourceTransform,
} from "../../src/cli/transform/source-transform.js";
import {
  collectEnvelopePaths,
  normalizedUrl,
  officerMentions,
} from "../lib/youtube-coverage.js";
import { CHANNEL_ID, SOURCE_ID, SOURCE_NAME } from "./channel.js";

export const produces: readonly ImportArtifactKind[] = [
  "CoverageLinks",
  "CoverageLinkAgencyPersonnel",
];

export const description =
  "Law&Crime Network (YouTube) — videos published in the rolling five-year window, found by searching the channel per agency, linked only to an officer that already exists at that already-existing agency (resolved via the fuzzy agency_personnel resolver, ADR 0022/0023). The channel's framing is an attributed claim; only the resolved officer link is a fact, cited to the naming passage. No video media is ingested.";

// The acquired evidence shape this transform reads: what acquire preserved for
// each in-window video it stored for an agency. Captions are absent by design —
// www.youtube.com/robots.txt disallows /api/, which is where the timedtext track
// lives, so this source reads only the Data API's title and description.
export type AcquiredVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId: string;
  url: string;
  retrievedAt: string;
};

type VideoEnvelope = {
  agency: { id?: string; name?: string; state?: string };
  channel?: { channelId?: string };
  window?: { from?: string; to?: string };
  videos?: AcquiredVideo[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
  let considered = 0;

  for (const file of files) {
    const envelope = JSON.parse(await readFile(file, "utf8")) as VideoEnvelope;
    // Re-check the channel here, not only in acquire: a replay imports an
    // archived envelope without acquire ever running, and the pinned channel is
    // the whole basis for calling this source Law&Crime Network.
    const envelopeChannelId = text(envelope.channel?.channelId);
    if (envelopeChannelId !== CHANNEL_ID) {
      throw new Error(
        `${SOURCE_ID}: ${path.basename(file)} declares channel ${envelopeChannelId || "(none)"}, not the pinned ${CHANNEL_ID}.`,
      );
    }
    const agencyId = text(envelope.agency.id);
    const agencyName = text(envelope.agency.name);
    if (agencyId === "" || agencyName === "") continue;

    for (const video of envelope.videos ?? []) {
      const videoId = text(video.videoId);
      const url = text(video.url);
      const title = text(video.title);
      if (videoId === "" || url === "" || title === "") continue;
      if (text(video.channelId) !== CHANNEL_ID) {
        throw new Error(
          `${SOURCE_ID}: video ${videoId} in ${path.basename(file)} belongs to channel ${text(video.channelId) || "(none)"}, not the pinned ${CHANNEL_ID}.`,
        );
      }
      considered += 1;

      // The agency is fixed by acquire, which enumerated it from the database, so
      // the agency half of the match already exists by construction. Resolve
      // every officer the video names AT THAT AGENCY: a name resolving to no
      // existing officer, or ambiguously between two, yields no link — never a
      // guess, never a new record. Skipping is this run's outcome only; the
      // video stays in the envelope and is reconsidered on every later run while
      // it remains in the window.
      const resolved = new Map<string, string>();
      for (const mention of officerMentions([video.title, video.description])) {
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
          source_name: SOURCE_NAME,
          published_at: /^\d{4}-\d{2}-\d{2}$/.test(publishedAt)
            ? publishedAt
            : null,
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

  const linked = Object.keys(coverageLinks).length;
  log.info(
    `${SOURCE_ID}: ${considered} in-window videos considered, ${linked} with a resolved officer ` +
      `(${considered - linked} skipped this run, reconsidered while in window), ` +
      `${Object.keys(coverageLinkAgencyPersonnel).length} video-officer links`,
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
