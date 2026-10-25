import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  EmittedRecords,
  TransformDeps,
  SourceTransform,
} from "../../src/cli/transform/source-transform.js";
import { officerMentions } from "../lib/officer-mentions.js";
import type { AcquiredVideo } from "./video-cache.js";

export const produces: readonly ImportArtifactKind[] = [
  "CoverageLinks",
  "CoverageLinkAgencyPersonnel",
];

export const description =
  "PoliceActivity (YouTube) — videos found by searching the channel per agency, linked to any officer at that agency the video names (resolved via the fuzzy agency_personnel resolver, ADR 0022/0023). The channel's framing is an attributed claim; only the resolved officer link is a fact, cited to the naming passage.";

type VideoEnvelope = {
  agency: { id?: string; name?: string; state?: string };
  videos?: AcquiredVideo[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// The distinct officer mentions in a video, each with its first supporting
// passage across the title, description, and captions. Names are only ever
// CANDIDATES — the intake-owned resolver gates them against the agency roster
// (confidence floor + ambiguity band); we never guess (#52).
function videoOfficerMentions(video: AcquiredVideo) {
  return officerMentions([video.title, video.description, video.captions]);
}

function normalizedUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

export const transform: SourceTransform = async ({
  paths,
  data,
  logger,
}: TransformDeps) => {
  const log = logger ?? { info() {} };
  if (data === undefined) {
    throw new Error(
      "youtube.policeactivity: run requires a data context (DATABASE_URL) to resolve officers (ADR 0023).",
    );
  }
  const envelopePaths = paths.filter((p) => p.endsWith(".videos.json"));
  const files =
    envelopePaths.length > 0
      ? envelopePaths
      : await collectEnvelopePaths(paths);

  const coverageLinks: EmittedRecords = {};
  const coverageLinkAgencyPersonnel: EmittedRecords = {};

  for (const file of files) {
    const envelope = JSON.parse(await readFile(file, "utf8")) as VideoEnvelope;
    const agencyId = text(envelope.agency.id);
    const agencyName = text(envelope.agency.name);
    if (agencyId === "" || agencyName === "") continue;

    for (const video of envelope.videos ?? []) {
      const videoId = text(video.videoId);
      const url = text(video.url);
      const title = text(video.title);
      if (videoId === "" || url === "" || title === "") continue;

      // Resolve every officer the video names AT THIS AGENCY (the agency is fixed
      // by acquire). A name resolving to no existing officer, or ambiguously,
      // yields no link — never a guess, never a new record.
      const resolved = new Map<string, string>();
      for (const mention of videoOfficerMentions(video)) {
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
          source_name: "PoliceActivity",
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
    `youtube.policeactivity: ${Object.keys(coverageLinks).length} videos with a resolved officer, ` +
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
