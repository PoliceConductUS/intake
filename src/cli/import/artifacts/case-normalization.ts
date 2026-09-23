import { normalizeTextWhitespace } from "../../../shared/text.js";
import nameCaseLib from "namecase";

/**
 * Casing normalization for TCOLE-style ALL-CAPS source data. These are pure,
 * idempotent string functions applied through facade property resolvers (never a
 * pre-DB transform pass — the forbidden pattern in this codebase).
 *
 * Organization/address casing is our own heuristic. Personal names preserve
 * mixed-case source spelling; uniformly cased names use the `namecase` library's
 * display heuristics. Neither heuristic verifies a person's preferred spelling.
 */

/**
 * Small connective words rendered lowercase inside an organization or address
 * name — EXCEPT when they are the first word. Extension point: add words here.
 */
const ORGANIZATION_SMALL_WORDS: ReadonlySet<string> = new Set([
  "of",
  "the",
  "and",
  "for",
  "to",
  "at",
  "in",
  "on",
  "a",
  "an",
  "by",
]);

/**
 * Curated acronyms that must stay fully uppercase. Needed because the
 * all-consonant heuristic alone cannot catch vowel-bearing acronyms such as FBI
 * or DEA. Extension point: add domain acronyms here.
 */
const ORGANIZATION_ACRONYMS: ReadonlySet<string> = new Set([
  "FBI",
  "ATF",
  "DEA",
  "ICE",
  "TSA",
  "CBP",
  "DOJ",
  "DHS",
  "DPS",
  "PD",
  "SO",
  "US",
  "USA",
  "ISD",
  "HP",
  "CID",
  "SWAT",
]);

/**
 * Consonant-only street/title abbreviations that must be TITLE-cased even though
 * the all-consonant heuristic would otherwise treat them as acronyms (e.g. `ST`
 * -> `St`, not `ST`). Extension point: add abbreviations here.
 */
const ORGANIZATION_TITLE_ABBREVIATIONS: ReadonlySet<string> = new Set([
  "ST",
  "RD",
  "DR",
  "MT",
  "FT",
  "LN",
  "PL",
  "CT",
  "SQ",
  "TER",
  "BLVD",
  "PKWY",
  "HWY",
]);

/** Ordinal token like `4TH` / `1ST` / `2ND` / `3RD` -> lowercase suffix. */
const ORDINAL_PATTERN = /^(\d+)(st|nd|rd|th)$/i;

/** Dotted initials such as `U.S.` or `N.W.` (two-or-more letter-dot groups). */
const DOTTED_INITIALS_PATTERN = /^(?:\p{L}\.){2,}$/u;

const LEADING_NON_ALNUM = /^[^\p{L}\p{N}]+/u;
const TRAILING_NON_ALNUM = /[^\p{L}\p{N}]+$/u;

/** Lowercase a segment, then uppercase its first character. */
function capitalizeSegment(segment: string): string {
  if (segment.length === 0) {
    return segment;
  }
  return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
}

/** Title-case a word, capitalizing each hyphen-separated segment. */
function titleCaseWord(word: string): string {
  return word.split("-").map(capitalizeSegment).join("-");
}

/**
 * Heuristic acronym test: an already ALL-CAPS token of length <= 4 with no
 * vowels (e.g. `PD`, `DPS`). Requiring the source to already be all-caps keeps
 * the function idempotent — a title-cased word is never re-uppercased.
 */
function isHeuristicAcronym(core: string): boolean {
  return (
    core.length <= 4 &&
    /[A-Za-z]/.test(core) &&
    core === core.toUpperCase() &&
    !/[AEIOU]/i.test(core)
  );
}

/** Case the alphanumeric core of an organization/address token. */
function caseOrganizationCore(core: string, isFirstWord: boolean): string {
  const ordinal = core.match(ORDINAL_PATTERN);
  if (ordinal) {
    return `${ordinal[1]}${ordinal[2].toLowerCase()}`;
  }
  const upper = core.toUpperCase();
  if (ORGANIZATION_ACRONYMS.has(upper)) {
    return upper;
  }
  const lower = core.toLowerCase();
  if (!isFirstWord && ORGANIZATION_SMALL_WORDS.has(lower)) {
    return lower;
  }
  if (
    isHeuristicAcronym(core) &&
    !ORGANIZATION_TITLE_ABBREVIATIONS.has(upper)
  ) {
    return upper;
  }
  return titleCaseWord(core);
}

/** Case a single whitespace-delimited organization/address token. */
function processOrganizationToken(token: string, isFirstWord: boolean): string {
  // Dotted initials (U.S., N.W.) are evaluated on the whole token, since their
  // trailing period would otherwise be stripped as punctuation.
  if (DOTTED_INITIALS_PATTERN.test(token)) {
    return token.toUpperCase();
  }
  const leading = token.match(LEADING_NON_ALNUM)?.[0] ?? "";
  const trailing = token.match(TRAILING_NON_ALNUM)?.[0] ?? "";
  const core = token.slice(leading.length, token.length - trailing.length);
  if (core.length === 0) {
    return token;
  }
  return `${leading}${caseOrganizationCore(core, isFirstWord)}${trailing}`;
}

/**
 * Title-case an organization or address name (e.g. `SMITHVILLE POLICE DEPT.` ->
 * `Smithville Police Dept.`). Lowercases small connectives except when first,
 * preserves curated/heuristic acronyms and dotted initials, and lowercases
 * ordinal suffixes. Idempotent. Heuristic — see the const sets above to extend.
 */
export function titleCase(input: string): string {
  const trimmed = normalizeTextWhitespace(input);
  if (trimmed.length === 0) {
    return "";
  }
  return trimmed
    .split(/\s+/)
    .map((token, index) => processOrganizationToken(token, index === 0))
    .join(" ");
}

/**
 * Preserve mixed-case source spelling. Only uniformly cased names need the
 * library's display-casing heuristics; those guesses are not spelling evidence.
 */
export function nameCase(input: string): string {
  const trimmed = normalizeTextWhitespace(input);
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed !== trimmed.toUpperCase() && trimmed !== trimmed.toLowerCase()) {
    return trimmed;
  }
  // namecase 1.1.2 consumes one separator after abbreviations such as ST and
  // the particle Y. Give it two; its final whitespace collapse leaves one.
  return nameCaseLib(trimmed.replaceAll(" ", "  "));
}

/** Use one spelling for junior/senior suffixes, regardless of source punctuation. */
export function nameSuffix(input: string): string {
  const trimmed = normalizeTextWhitespace(input);
  if (/^jr\.*$/i.test(trimmed)) return "Jr.";
  if (/^sr\.*$/i.test(trimmed)) return "Sr.";
  return nameCaseLib(trimmed);
}

/** Normalize an email address: trim and lowercase. Idempotent. */
export function lowerCaseEmail(input: string): string {
  return input.trim().toLowerCase();
}
