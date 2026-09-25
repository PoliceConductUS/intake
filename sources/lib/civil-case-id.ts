import { slugify } from "./civil-defendants.js";

/**
 * A CivilCase's canonical id is its normalized natural key — `court:docket` —
 * so any source describing the same docket computes the same id and they converge
 * with no registry (ADR 0028). This module builds that key.
 *
 * The court token is CourtListener's `court_id` (`txnd`, `ca5`, `scotus`) — the
 * de-facto US court taxonomy. A source that has the `court_id` natively
 * (CourtListener) uses it; the Clearinghouse has only a court *name*, mapped here.
 * An unmapped court falls back to a slug of the name: deterministic and safe, but
 * it will not match another source's `court_id`, so it only misses a merge — it
 * never merges two distinct cases (the ADR 0028 safety invariant).
 */
export const COURT_ID_BY_NAME: Record<string, string> = {
  "District of District of Columbia": "dcd",
  "District of Minnesota": "mnd",
  "Northern District of Texas": "txnd",
  "Southern District of Texas": "txsd",
  "Eastern District of Texas": "txed",
  "Western District of Texas": "txwd",
  "Southern District of California": "casd",
  "Eastern District of Virginia": "vaed",
  "U.S. Court of Appeals for the District of Columbia Circuit": "cadc",
  "U.S. Court of Appeals for the Fourth Circuit": "ca4",
  "U.S. Court of Appeals for the Fifth Circuit": "ca5",
  "U.S. Court of Appeals for the Eighth Circuit": "ca8",
  "Supreme Court of the United States": "scotus",
};

/** The CourtListener `court_id` for a Clearinghouse court name, or a slug of the
 * name when unmapped (a safe non-matching fallback — see the module comment). */
export function courtTokenFromName(courtName: string): string {
  const name = courtName.trim();
  return COURT_ID_BY_NAME[name] ?? slugify(name);
}

/** Lowercase, strip surrounding and internal whitespace. CH's
 * `docket_number_manual` and CL's `docket_number` are already the same PACER
 * string (`3:16-cv-03089`), so this only guards against incidental spacing/case. */
export function normalizeDocketNumber(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "");
}

/** The natural-key id for a CivilCase: `<court token>:<normalized docket>`. */
export function civilCaseNaturalId(
  courtToken: string,
  docketNumber: string,
): string {
  return `${courtToken}:${normalizeDocketNumber(docketNumber)}`;
}
