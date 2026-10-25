/**
 * Name-quality rules applied at intake, before a record can reach the database.
 *
 * We publish claims about named human beings, so a name field holding a source
 * placeholder or a test fixture is not a cosmetic defect — it is a false
 * statement about a person. Excluding those values here, rather than hiding
 * them when rendering, keeps one truth in the database and means a reload plus
 * a republish is all it takes to correct the site (INS-69).
 *
 * The rules are deliberately narrow, because the obvious version is wrong. In
 * the live Texas corpus `Null`, `None`, `True`, `False`, `Sample`, `Tester`,
 * `Officer` and `Guest` are all real surnames held by real officers, and `Na`
 * is a real given-name component. Sweeping those tokens out of every name field
 * would have unpublished more than twenty real people. So:
 *
 *   - Only the **suffix** field gets an allow-list. Generational suffixes are a
 *     closed set in practice, which makes an allow-list safe there and unsafe
 *     everywhere else.
 *   - Only the **given name** is tested for fixture markers, and only against
 *     values that are not plausible given names in any naming tradition we
 *     serve. `Test` and `Tester` as *surnames* are explicitly not fixtures.
 *   - Ambiguity is never resolved by guessing. A suffix of `111` is very likely
 *     a mis-keyed `III`, but inferring that would substitute our inference for
 *     a public record, so the value is dropped and reported instead.
 */

/**
 * Suffixes we will store. Anything outside this set is a source artifact rather
 * than part of the person's name: TCOLE's `SFX` column carries `N/A`, `n/a` and
 * bare badge numbers, all of which were published verbatim as part of officers'
 * names.
 */
const GENERATIONAL_SUFFIXES = new Set([
  "jr",
  "jr.",
  "sr",
  "sr.",
  "i",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
  "vii",
  "viii",
  "ix",
  "x",
]);

/**
 * Given names that identify a test fixture rather than a person.
 *
 * Note what is absent: `Test` and `Tester` as surnames. Both are real surnames
 * in this corpus, held by officers at four different real agencies. A fixture
 * whose surname is `Test` but whose given name looks ordinary is excluded by
 * its fixture agency instead — see `isFixtureAgencyName`.
 */
const FIXTURE_GIVEN_NAMES = new Set([
  "test",
  "tester",
  "testing",
  "testuser",
  "user",
  "demo",
  "dummy",
  "example",
  "placeholder",
  "asdf",
  "qwerty",
  "foo",
  "bar",
  "baz",
  "xxx",
]);

/**
 * Agencies that exist only as test fixtures.
 *
 * `Central Texas Police Dept.` is not a real department: its published address
 * is `555 Texas Lane`, it carries no ORI, and its entire roster is five people
 * whose surname is `Test`. Matching the agency is what lets us exclude the
 * three of them whose given names (`Chester`, `Jessica`, `Roger`) are perfectly
 * ordinary, without having to decide whether `Test` is anyone's real surname.
 *
 * Add an entry only with that kind of evidence: no ORI, a placeholder address,
 * and a roster made up entirely of fixtures.
 */
const FIXTURE_AGENCY_NAMES = new Set(["central texas police dept"]);

const normalize = (value: string | null | undefined): string =>
  typeof value === "string" ? value.trim() : "";

/** Collapse punctuation and spacing so `Central Texas Police Dept.` matches. */
const normalizeAgencyName = (value: string | null | undefined): string =>
  normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The suffix to store, and the value rejected if it was not a real suffix.
 *
 * Rejecting a suffix never drops the person: the rest of the name is still
 * public-record data, and the slug is built from the given and family name
 * only, so the correction does not move the page.
 */
export function normalizeNameSuffix(value: string | null | undefined): {
  suffix: string | null;
  rejected: string | null;
} {
  const text = normalize(value);
  if (text === "") {
    return { suffix: null, rejected: null };
  }
  if (GENERATIONAL_SUFFIXES.has(text.toLowerCase())) {
    return { suffix: text, rejected: null };
  }
  return { suffix: null, rejected: text };
}

/**
 * Whether a record is a test fixture rather than a person, judged on the given
 * name alone. A record at a fixture agency is caught by `isFixtureAgencyName`
 * instead.
 */
export function isFixtureGivenName(value: string | null | undefined): boolean {
  return FIXTURE_GIVEN_NAMES.has(normalize(value).toLowerCase());
}

/** Whether an agency exists only as a test fixture. */
export function isFixtureAgencyName(value: string | null | undefined): boolean {
  return FIXTURE_AGENCY_NAMES.has(normalizeAgencyName(value));
}

/**
 * Whether a name component is unusable as a name: it has no letters at all.
 * Catches a given name of `9`, which was published as a person.
 */
export function isNonNameValue(value: string | null | undefined): boolean {
  const text = normalize(value);
  return text !== "" && !/\p{Letter}/u.test(text);
}

export const personNameQualityRules = Object.freeze({
  GENERATIONAL_SUFFIXES,
  FIXTURE_GIVEN_NAMES,
  FIXTURE_AGENCY_NAMES,
});
