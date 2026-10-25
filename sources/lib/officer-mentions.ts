// Officer-name candidates a publisher asserts in free text, with the passage
// asserting each one. Shared by every coverage source so one channel cannot
// drift into a looser reading of "this text names an officer" than another.
//
// Names are only ever CANDIDATES — the intake-owned resolver gates them against
// the agency roster (confidence floor + ambiguity band); we never guess (#52).

import { isPersonName } from "./civil-defendants.js";

// The role prefix is case-insensitive (`(?i:…)`) so "Officer"/"OFFICER"/"officer"
// all match; the name stays Title-case so only capitalized name words are
// captured (it stops at the next lowercase word, e.g. "responds").
const OFFICER_MENTION =
  /\b(?i:officers?|deputies|deputy|sergeants?|sgt|detectives?|det|lieutenants?|lt|corporals?|cpl|troopers?|chiefs?|captains?|capt|sheriffs?|marshals?|patrol(?:man|woman|men)?)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,2})/g;

export type OfficerMention = { name: string; passage: string };

/**
 * The distinct officer mentions across `fields` (e.g. a video's title then
 * description), each with the first passage that supports it. Fields are read in
 * order, so the earliest passage naming an officer is the one cited.
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
