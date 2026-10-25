import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  EmittedRecords,
  TransformDeps,
  SourceTransform,
} from "../../src/cli/transform/source-transform.js";
import { officerMentions } from "../lib/officer-mentions.js";
import {
  CHANNEL_ID,
  SOURCE_ID,
  SOURCE_NAME,
  WINDOW_YEARS,
  inWindow,
  runClock,
  windowStart,
} from "./channel.js";
import type { AcquiredVideo } from "./video-cache.js";

export const produces: readonly ImportArtifactKind[] = [
  "CoverageLinks",
  "CoverageLinkAgencyPersonnel",
];

export const description =
  "Donut Operator (YouTube) — commentary videos found by searching the channel per agency, emitted only when published inside a rolling five-year window AND naming at least one officer that resolves to an existing officer at that already-existing agency (fuzzy agency_personnel resolver, ADR 0022/0023). The channel's framing is an attributed claim; only the resolved officer link is a fact, cited to the naming passage.";

type VideoEnvelope = {
  agency: { id?: string; name?: string; state?: string };
  videos?: AcquiredVideo[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

export const transform: SourceTransform = async ({
  paths,
  data,
  env,
  logger,
}: TransformDeps) => {
  const log = logger ?? { info() {} };
  if (data === undefined) {
    throw new Error(
      `${SOURCE_ID}: run requires a data context (DATABASE_URL) to resolve officers (ADR 0023).`,
    );
  }
  const now = runClock(env);
  const envelopePaths = paths.filter((p) => p.endsWith(".videos.json"));
  const files = (
    envelopePaths.length > 0 ? envelopePaths : await collectEnvelopePaths(paths)
  )
    .slice()
    .sort();

  const coverageLinks: EmittedRecords = {};
  const coverageLinkAgencyPersonnel: EmittedRecords = {};

  // Every exclusion is counted, because "nothing was emitted" has to be
  // distinguishable from "nothing was looked at". These counts are the run's
  // change diff: why a video did or did not become a link.
  let considered = 0;
  let outOfWindow = 0;
  let wrongChannel = 0;
  let unnamed = 0;
  let unresolved = 0;

  for (const file of files) {
    const envelope = JSON.parse(await readFile(file, "utf8")) as VideoEnvelope;
    const agencyId = text(envelope.agency.id);
    const agencyName = text(envelope.agency.name);
    // The agency came from the acquire facade, so it already exists in the
    // database by construction — this source never resolves an agency from text
    // and never mints one. An envelope without one is unusable, not a licence to
    // guess.
    if (agencyId === "" || agencyName === "") continue;

    for (const video of envelope.videos ?? []) {
      const videoId = text(video.videoId);
      const url = text(video.url);
      const title = text(video.title);
      if (videoId === "" || url === "" || title === "") continue;
      considered += 1;

      if (text(video.channelId) !== CHANNEL_ID) {
        wrongChannel += 1;
        continue;
      }

      // The rolling window is enforced HERE, not only at acquire time. The
      // archive outlives any single run, so a video that has aged past five years
      // must stop producing a link on the next run even though it is still
      // cached.
      if (!inWindow(video.publishedAt, now)) {
        outOfWindow += 1;
        continue;
      }

      const mentions = officerMentions([
        video.title,
        video.description,
        video.captions,
      ]);
      if (mentions.length === 0) {
        unnamed += 1;
        continue;
      }

      // Resolve every officer the video names AT THIS AGENCY (the agency is fixed
      // by acquire). A name resolving to no existing officer, or ambiguously,
      // yields no link — never a guess, never a new record. A video skipped this
      // way is skipped for this run only: it stays in the archive and is
      // re-resolved on every later run, so it is picked up automatically once the
      // officer exists, for as long as it remains inside the window.
      const resolved = new Map<string, string>();
      for (const mention of mentions) {
        const match = await data.resolvePersonnel({
          agencyId,
          personnelName: mention.name,
        });
        if (match !== null && !resolved.has(match.agencyPersonnelId)) {
          resolved.set(match.agencyPersonnelId, mention.passage);
        }
      }
      if (resolved.size === 0) {
        unresolved += 1;
        continue;
      }

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

  log.info(
    `${SOURCE_ID}: ${considered} acquired video(s) considered in the ${WINDOW_YEARS}-year window ` +
      `since ${windowStart(now).toISOString()} — ${Object.keys(coverageLinks).length} linked, ` +
      `${outOfWindow} out of window, ${unnamed} naming no officer, ${unresolved} naming no officer that ` +
      `resolves at the acquired agency (retried next run), ${wrongChannel} not from the pinned channel; ` +
      `${Object.keys(coverageLinkAgencyPersonnel).length} video-officer link(s)`,
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
