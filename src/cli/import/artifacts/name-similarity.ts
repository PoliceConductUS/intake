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
