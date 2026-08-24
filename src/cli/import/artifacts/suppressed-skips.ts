import type { SuppressedSkip } from "./operations.js";

/**
 * Reporting the records an import declined to write because a subject is
 * suppressed.
 *
 * Every load is supposed to produce a change diff explaining what changed and
 * why. A record we chose not to update is part of that diff: it is the one
 * case where the database and the source disagree on purpose. Left unreported,
 * a honoured takedown is indistinguishable from a no-op, and the next person
 * to compare source to database reads it as drift.
 */

const entityLabels: Record<SuppressedSkip["entity"], string> = {
  agency: "Agency",
  personnel: "Personnel",
  agencyPersonnel: "AgencyPersonnel",
};

/**
 * Identity is not optional here. A count alone tells an operator that
 * something was withheld but not which record, and "which record" is exactly
 * what a correction or an audit needs. Full list, no truncation: the number of
 * active suppressions is small by construction, and a summary that silently
 * cut off at ten would be the same failure this reporting exists to fix.
 */
export function formatSuppressedSkipLines(
  skips: readonly SuppressedSkip[],
): string[] {
  if (skips.length === 0) {
    return [];
  }
  return [
    `Records skipped because a subject is suppressed: ${skips.length}`,
    ...skips.map((skip) => {
      const cause = skip.suppressedSubjectIds.includes(skip.recordId)
        ? "suppressed"
        : `suppressed via ${skip.suppressedSubjectIds.join(", ")}`;
      return `  ${entityLabels[skip.entity]} ${skip.recordId} (${cause}); withheld: ${skip.withheldColumns.join(", ")}`;
    }),
  ];
}

/** Structured form for the log record, which is what an audit reads later. */
export function suppressedSkipLogFields(skips: readonly SuppressedSkip[]): {
  suppressedSkipCount: number;
  suppressedSkips: readonly SuppressedSkip[];
} {
  return { suppressedSkipCount: skips.length, suppressedSkips: skips };
}
