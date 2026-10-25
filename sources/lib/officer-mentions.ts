// Candidate officer names a publisher asserts in free text (a video title,
// description, or caption track), each with the passage that asserts it.
//
// This heuristic lives here, once, on purpose. Every video-coverage source needs
// it, and it is the most safety-critical guess in the pipeline: a name pulled out
// of prose written for an audience is a CANDIDATE and nothing else. Whether it
// corresponds to a real person is decided downstream by the intake-owned resolver
// (ADR 0022/0023), which gates against the acquired agency's roster with a
// confidence floor and an ambiguity band. A source carrying its own copy of this
// regex would be a second, unreviewed gate on claims about named human beings.
import { isPersonName } from "./civil-defendants.js";

// A role word followed by a Title-case name. The role prefix is case-insensitive
// (`(?i:…)`) so "Officer"/"OFFICER"/"officer" all match; the name stays Title-case
// so only capitalized name words are captured (it stops at the next lowercase
// word, e.g. "responds").
export const OFFICER_MENTION =
  /\b(?i:officers?|deputies|deputy|sergeants?|sgt|detectives?|det|lieutenants?|lt|corporals?|cpl|troopers?|chiefs?|captains?|capt|sheriffs?|marshals?|patrol(?:man|woman|men)?)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,2})/g;

/** A name a publisher asserts, and the first passage asserting it. */
export type OfficerMention = { name: string; passage: string };

/**
 * The distinct officer mentions across `fields`, in the order the fields are
 * given, each keeping its first supporting passage. Fields are searched in order,
 * so callers should pass them most-authoritative first (title, then description,
 * then captions) — the passage recorded for a name is the first one found.
 */
export function officerMentions(
  fields: readonly (string | null | undefined)[],
): OfficerMention[] {
  const found = new Map<string, string>();
  for (const field of fields) {
    if (typeof field !== "string" || field === "") continue;
    for (const match of field.matchAll(OFFICER_MENTION)) {
      const name = match[1].trim();
      if (!isPersonName(name) || found.has(name)) continue;
      found.set(name, match[0].trim());
    }
  }
  return [...found].map(([name, passage]) => ({ name, passage }));
}
