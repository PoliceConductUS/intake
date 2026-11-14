import { readdir } from "node:fs/promises";
import path from "node:path";
import { isPersonName } from "./civil-defendants.js";

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

// Officer-name candidate extraction shared by the YouTube channel coverage
// sources. A named officer the publisher asserts, and the passage asserting it.
// Names are only ever CANDIDATES — the intake-owned resolver gates them against
// the agency roster (confidence floor + ambiguity band); we never guess (#52).
// The role prefix is case-insensitive (`(?i:…)`) so "Officer"/"OFFICER"/"officer"
// all match; the name stays Title-case so only capitalized name words are
// captured (it stops at the next lowercase word, e.g. "responds").
const OFFICER_MENTION =
  /\b(?i:officers?|deputies|deputy|sergeants?|sgt|detectives?|det|lieutenants?|lt|corporals?|cpl|troopers?|chiefs?|captains?|capt|sheriffs?|marshals?|patrol(?:man|woman|men)?)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,2})/g;

export type OfficerMention = { name: string; passage: string };

/**
 * The distinct officer mentions across `fields` (title, description, and any
 * further text a source has), each with its first supporting passage. Field
 * order decides which passage is cited for a name mentioned more than once.
 */
export function officerMentions(fields: readonly string[]): OfficerMention[] {
  const found = new Map<string, string>();
  for (const field of fields) {
    for (const match of field.matchAll(OFFICER_MENTION)) {
      const name = match[1].trim();
      if (!isPersonName(name) || found.has(name)) continue;
      found.set(name, match[0].trim());
    }
  }
  return [...found].map(([name, passage]) => ({ name, passage }));
}

export function normalizedUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}
