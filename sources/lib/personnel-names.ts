import { bodyNameMatcher } from "./news.js";
export type PersonnelNameFields = {
  name: string;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  suffix?: string | null;
};
export function personnelSearchNames(person: PersonnelNameFields) {
  const names = new Set<string>();
  if (person.name.trim()) names.add(person.name.trim());
  if (!person.firstName || !person.lastName) return [...names];
  const embedded = person.lastName.match(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i);
  const last = embedded
    ? person.lastName.slice(0, embedded.index).trim()
    : person.lastName;
  const suffix = person.suffix || embedded?.[1];
  const middle = person.middleName?.trim();
  const initials = middle
    ?.split(/\s+/)
    .map((word) => word[0] + ".")
    .join(" ");
  for (const m of [middle, initials, undefined]) {
    for (const ending of [suffix, undefined])
      names.add([person.firstName, m, last, ending].filter(Boolean).join(" "));
  }
  return [...names].sort((a, b) => b.length - a.length);
}
export function personnelNameEvidence(
  variants: readonly string[],
  paragraphs: readonly { hash: string; text: string }[],
) {
  const checks = paragraphs.map((p) => ({
    hash: p.hash,
    matches: bodyNameMatcher(p.text),
  }));
  return variants.flatMap((name) => {
    const paragraphHashes = checks
      .filter((p) => p.matches(name))
      .map((p) => p.hash);
    return paragraphHashes.length ? [{ name, paragraphHashes }] : [];
  });
}
