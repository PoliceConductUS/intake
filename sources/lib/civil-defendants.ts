const INSTITUTION =
  /county|city|department|dept|police|sheriff|state|univ|correction|bureau|office|division|commission|board|district|authority|jail|prison|town|village|dps|patrol|marshal|constable|agency|department of/i;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isPersonDefendant(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed !== "" &&
    !INSTITUTION.test(trimmed) &&
    /^[A-Z][a-z]+ [A-Z]/.test(trimmed)
  );
}

export function primaryAgencyName(
  names: readonly string[],
): string | undefined {
  return names
    .map((name) => name.trim())
    .find((name) => name !== "" && INSTITUTION.test(name));
}
