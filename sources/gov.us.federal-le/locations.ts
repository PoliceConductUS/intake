export const LOCATIONS_FILE = "agency-locations.yaml";

/**
 * A federal agency's curated headquarters location, keyed by `slug` (slugify of
 * the Wikipedia agency name). Lives in state (not the repo) because it changes
 * without a software release. `run` emits an Agency only when every field is
 * filled; incomplete stubs are skipped until a curator completes them.
 */
export type AgencyLocation = {
  slug: string;
  name: string;
  state: string;
  city: string;
  address: string;
  zip_code: string;
};

/**
 * Merge newly-discovered agencies into the existing curated list as blank stubs,
 * preserving every existing (curated) entry untouched. Returns the merged list
 * sorted by slug and the slugs that were newly added.
 */
export function mergeLocationStubs(
  existing: readonly AgencyLocation[],
  discovered: ReadonlyArray<{ slug: string; name: string }>,
): { agencies: AgencyLocation[]; added: string[] } {
  const bySlug = new Map(existing.map((entry) => [entry.slug, entry]));
  const added: string[] = [];
  for (const agency of discovered) {
    if (bySlug.has(agency.slug)) continue;
    bySlug.set(agency.slug, {
      slug: agency.slug,
      name: agency.name,
      state: "",
      city: "",
      address: "",
      zip_code: "",
    });
    added.push(agency.slug);
  }
  const agencies = [...bySlug.values()].sort((left, right) =>
    left.slug.localeCompare(right.slug),
  );
  return { agencies, added };
}
