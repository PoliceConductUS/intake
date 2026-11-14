import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { PublicationWindow } from "../lib/rolling-window.js";
import { SOURCE_ID } from "./channel.js";
import type { AcquiredVideo } from "./video-cache.js";

// The per-agency evidence envelope: what acquire writes and the deterministic
// produce phase reads. The run's rolling window travels on it, so produce applies
// the window the evidence was collected under instead of reading the clock.
// Validated on write and on read — incomplete evidence is an error, never a
// silently dropped record.

const isoTimestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "must be an ISO timestamp",
  });

export const AcquiredVideoSchema = z
  .object({
    videoId: z.string().min(1),
    title: z.string(),
    description: z.string(),
    publishedAt: isoTimestamp,
    channelId: z.string().min(1),
    url: z.string().min(1),
    retrievedAt: isoTimestamp,
  })
  .strict();

export const VideoEnvelopeSchema = z
  .object({
    source: z
      .object({
        name: z.string().min(1),
        handle: z.string().min(1),
        channelUrl: z.string().min(1),
        channelId: z.string().min(1),
      })
      .strict(),
    window: z.object({ start: isoTimestamp, end: isoTimestamp }).strict(),
    agency: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        state: z.string(),
        county: z.string(),
        place: z.string(),
      })
      .strict(),
    videos: z.array(AcquiredVideoSchema),
  })
  .strict();

export type VideoEnvelope = z.infer<typeof VideoEnvelopeSchema>;

export const ENVELOPE_SUFFIX = ".videos.json";

export async function writeVideoEnvelope(
  filePath: string,
  envelope: {
    source: VideoEnvelope["source"];
    window: PublicationWindow;
    agency: VideoEnvelope["agency"];
    videos: readonly AcquiredVideo[];
  },
): Promise<void> {
  const validated = VideoEnvelopeSchema.parse({
    ...envelope,
    videos: [...envelope.videos],
  });
  await writeFile(filePath, `${JSON.stringify(validated, null, 2)}\n`);
}

export async function readVideoEnvelope(
  filePath: string,
): Promise<VideoEnvelope> {
  const parsed = VideoEnvelopeSchema.safeParse(
    JSON.parse(await readFile(filePath, "utf8")) as unknown,
  );
  if (!parsed.success) {
    throw new Error(
      `${SOURCE_ID}: ${filePath} is not a valid video evidence envelope: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}
