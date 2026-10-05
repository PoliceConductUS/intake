const NAME_SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b/g;

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(NAME_SUFFIX, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type NameMatch = {
  /** Similarity in [0, 1] requiring BOTH the first and last name to match. */
  confidence: number;
  /**
   * How far the match strayed from the name exactly as listed: the number of
   * middle name-parts on the party side that had to be ignored to line up first
   * and last (0 = used the whole name as listed). The caller ranks by confidence
   * and breaks ties by preferring the lowest uncertainty (the fullest form).
   */
  uncertainty: number;
};

function nameTokens(value: string): string[] {
  return normalizeName(value)
    .split(" ")
    .filter((token) => token !== "");
}

function officerPart(officer: Record<string, unknown>, key: string): string {
  const value = officer[key];
  return normalizeName(typeof value === "string" ? value : "");
}

/**
 * Confidence that a listed party name is a given officer, scoring the first and
 * last name SEPARATELY and taking the lower of the two — a strong last name can
 * never carry a wrong first name (e.g. "Ana Ramirez" ≠ "Juan Ramirez"). Both
 * name orderings are tried so a "Last First" caption still matches. Compatible
 * first/middle initials are likely matches; conflicting supplied middle names
 * reject a candidate. Uncorroborated middle parts count as uncertainty.
 * Suffixes are already dropped by
 * {@link normalizeName}.
 */
export function officerNameConfidence(
  partyName: string,
  officer: Record<string, unknown>,
): NameMatch {
  const party = nameTokens(partyName);
  if (party[0] === "officer" || party[0] === "chief") party.shift();
  if (party.length === 0) return { confidence: 0, uncertainty: 0 };
  const rosterFirst = officerPart(officer, "first_name");
  const rosterLast = officerPart(officer, "last_name");
  const partyFirst = party[0];
  const partyLast = party[party.length - 1];
  const partyMiddle = party.slice(1, -1);
  const rosterMiddle = nameTokens(officerPart(officer, "middle_name"));
  let middleConfidence = 1;
  let uncertainty = 0;
  for (let index = 0; index < partyMiddle.length; index++) {
    if (rosterMiddle[index] === undefined) {
      uncertainty++;
    } else {
      middleConfidence = Math.min(
        middleConfidence,
        givenNameSimilarity(partyMiddle[index], rosterMiddle[index]),
      );
    }
  }
  const forward = Math.min(
    givenNameSimilarity(partyFirst, rosterFirst),
    nameSimilarity(partyLast, rosterLast),
    middleConfidence,
  );
  const reversed = Math.min(
    givenNameSimilarity(partyLast, rosterFirst),
    nameSimilarity(partyFirst, rosterLast),
    middleConfidence,
  );
  return { confidence: Math.max(forward, reversed), uncertainty };
}

function givenNameSimilarity(left: string, right: string): number {
  if (
    left !== "" &&
    right !== "" &&
    (left.length === 1 || right.length === 1) &&
    left[0] === right[0]
  ) {
    return 0.9;
  }
  return nameSimilarity(left, right);
}

function bigrams(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  const compact = value.replace(/ /g, "");
  for (let i = 0; i < compact.length - 1; i++) {
    const gram = compact.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/**
 * Sørensen–Dice similarity of two names in [0, 1] over character bigrams of
 * their normalized forms. 1 is identical; 0 shares no bigrams.
 */
export function nameSimilarity(left: string, right: string): number {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (a === "" || b === "") return 0;
  if (a === b) return 1;
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  let intersection = 0;
  for (const [gram, count] of aGrams) {
    const other = bGrams.get(gram);
    if (other !== undefined) intersection += Math.min(count, other);
  }
  const total =
    [...aGrams.values()].reduce((sum, n) => sum + n, 0) +
    [...bGrams.values()].reduce((sum, n) => sum + n, 0);
  return total === 0 ? 0 : (2 * intersection) / total;
}
