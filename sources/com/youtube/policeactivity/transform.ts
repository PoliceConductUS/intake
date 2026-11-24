import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  EmittedRecords,
  TransformDeps,
  SourceTransform,
} from "../../../../src/cli/transform/source-transform.js";
import { isPersonName } from "../../../lib/civil-defendants.js";
import type { AcquiredVideo } from "./video-cache.js";

type VideoEnvelope = {
  agency?: { id?: string; name?: string; state?: string };
  videos?: AcquiredVideo[];
};

const NO_KNOWN_OFFICER = "names no officer the database knows";

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

// The distinct officer mentions in a video, each with its first supporting
// passage across the title and description.
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

export const transform: SourceTransform = async ({
  paths,
  data,
  logger,
}: TransformDeps) => {
  const log = logger ?? { info() {} };
  if (data === undefined) {
    throw new Error(
      "com/youtube/policeactivity: run requires a data context (DATABASE_URL) to resolve officers (ADR 0023).",
    );
  }
  const envelopePaths = paths.filter((p) => p.endsWith(".videos.json"));
  const files =
    envelopePaths.length > 0
      ? envelopePaths
      : await collectEnvelopePaths(paths);

  const coverageLinks: EmittedRecords = {};
  const coverageLinkAgencyPersonnel: EmittedRecords = {};
  const fileOfVideo = new Map<string, string>();
  let read = 0;
  let emitted = 0;
  let noKnownOfficer = 0;

  for (const file of files) {
    const envelope = JSON.parse(await readFile(file, "utf8")) as VideoEnvelope;
    const agencyId = text(envelope.agency?.id);
    const agencyName = text(envelope.agency?.name);
    if (agencyId === "" || agencyName === "") {
      throw new Error(
        `com/youtube/policeactivity: ${file} has no agency ID or name.`,
      );
    }
    if (!Array.isArray(envelope.videos)) {
      throw new Error(
        `com/youtube/policeactivity: ${file} has no videos list.`,
      );
    }

    for (const [index, video] of envelope.videos.entries()) {
      read += 1;
      const videoId = text(video.videoId);
      const url = text(video.url);
      const title = text(video.title);
      const row = `${file} video ${index + 1} (${JSON.stringify(videoId)})`;
      if (videoId === "" || url === "" || title === "") {
        throw new Error(
          `com/youtube/policeactivity: ${row} has no video ID, URL or title.`,
        );
      }
      const publishedAt = text(video.publishedAt).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) {
        throw new Error(
          `com/youtube/policeactivity: ${row} has a published date that is not a date: ${JSON.stringify(video.publishedAt)}.`,
        );
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
        noKnownOfficer += 1;
        continue;
      }

      const spec = {
        url,
        normalized_url: normalizedUrl(url),
        title,
        source_name: "PoliceActivity",
        published_at: publishedAt,
        // The publisher's framing, kept as an attributed claim (#52).
        notes: text(video.description) || null,
      };
      const earlier = coverageLinks[videoId];
      if (earlier !== undefined && !isDeepStrictEqual(earlier.spec, spec)) {
        throw new Error(
          `com/youtube/policeactivity: video ${videoId} in ${file} differs from the same video in ${fileOfVideo.get(videoId)}.`,
        );
      }
      coverageLinks[videoId] = { spec };
      fileOfVideo.set(videoId, file);
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
      emitted += 1;
    }
  }

  log.info(
    `com/youtube/policeactivity: ${Object.keys(coverageLinks).length} videos with a resolved officer, ` +
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
    accounting: [
      {
        input: "videos",
        read,
        emitted,
        reported: 0,
        notSelected: { [NO_KNOWN_OFFICER]: noKnownOfficer },
      },
    ],
  };
};

async function collectEnvelopePaths(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const base of paths) {
    for (const entry of await readdir(base)) {
      if (entry.endsWith(".videos.json")) files.push(path.join(base, entry));
    }
  }
  return files;
}
