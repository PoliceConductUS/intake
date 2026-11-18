import type { InputAccounting } from "../../../../../../src/cli/transform/accounting.js";

/**
 * Ported verbatim from `intake.us-census-gazetteer/src/address-location-evidence.js`.
 * Only `allowedStateSlugs` — the piece `location-paths.ts` depends on — is
 * carried over; the rest of that file is standalone-producer plumbing and is
 * intentionally left behind.
 *
 * `allowedStateGeoids` is ported verbatim from
 * `intake.us-census-gazetteer/src/tiger-hierarchy.js` and lives here (rather
 * than in `tiger-hierarchy.ts`) so both TIGER feature filtering and any
 * other module that needs the 50-states-plus-DC GEOID allowlist share one
 * copy, deduped as directed by the migration plan.
 */

export const SOURCE_ID = "gov/census/www2/gazetteer";

export const OUTSIDE_ALLOWED_STATES =
  "outside 50 states plus District of Columbia";

export type RowCounts = Omit<InputAccounting, "input">;

export const rowCounts = (): RowCounts => ({
  read: 0,
  emitted: 0,
  reported: 0,
  notSelected: {},
});

export function countNotSelected(counts: RowCounts, reason: string): void {
  counts.notSelected[reason] = (counts.notSelected[reason] ?? 0) + 1;
}

export const allowedStateGeoids = new Set([
  "01",
  "02",
  "04",
  "05",
  "06",
  "08",
  "09",
  "10",
  "11",
  "12",
  "13",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29",
  "30",
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "37",
  "38",
  "39",
  "40",
  "41",
  "42",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "50",
  "51",
  "53",
  "54",
  "55",
  "56",
]);

export const allowedStateSlugs = new Set([
  "al",
  "ak",
  "az",
  "ar",
  "ca",
  "co",
  "ct",
  "de",
  "dc",
  "fl",
  "ga",
  "hi",
  "id",
  "il",
  "in",
  "ia",
  "ks",
  "ky",
  "la",
  "me",
  "md",
  "ma",
  "mi",
  "mn",
  "ms",
  "mo",
  "mt",
  "ne",
  "nv",
  "nh",
  "nj",
  "nm",
  "ny",
  "nc",
  "nd",
  "oh",
  "ok",
  "or",
  "pa",
  "ri",
  "sc",
  "sd",
  "tn",
  "tx",
  "ut",
  "vt",
  "va",
  "wa",
  "wv",
  "wi",
  "wy",
]);
