import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
export const COMMIT = "cb0fb99586ec3a820c7aa0824acfb190037de106";
export const FILES = [
  "fatal-police-shootings-data.csv",
  "fatal-police-shootings-agencies.csv",
] as const;
export const DATASET =
  "https://github.com/washingtonpost/data-police-shootings";
export const fileUrl = (commit: string, file: string) =>
  `https://raw.githubusercontent.com/washingtonpost/data-police-shootings/${commit}/v2/${file}`;
const Evidence = z
  .object({
    sourceUrl: z.string().url(),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    byteLength: z.number().int().nonnegative(),
    retrievedAt: z.iso.datetime(),
  })
  .strict();
export const Provenance = z.record(z.enum(FILES), Evidence);
export const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export async function readEvidence(directory: string) {
  const evidence = Provenance.parse(
    JSON.parse(await readFile(path.join(directory, "provenance.json"), "utf8")),
  );
  for (const file of FILES) {
    const bytes = await readFile(path.join(directory, file));
    const record = evidence[file];
    if (
      record.sourceUrl !== fileUrl(record.commit, file) ||
      bytes.length !== record.byteLength ||
      digest(bytes) !== record.sha256
    )
      throw new Error(
        `Fatal Force evidence checksum or source URL mismatch: ${file}`,
      );
  }
  if (evidence[FILES[0]].commit !== evidence[FILES[1]].commit)
    throw new Error("Fatal Force files have different commits");
  return evidence;
}
