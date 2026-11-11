import { readdir } from "node:fs/promises";
import path from "node:path";
export { officerMentions, type OfficerMention } from "./officer-mentions.js";

/** The per-agency acquired-evidence files under the paths a run was given. */
export async function collectEnvelopePaths(
  paths: readonly string[],
): Promise<string[]> {
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

export function normalizedUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}
