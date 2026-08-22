export const LOCATIONS_FILE = "agency-locations.yaml";

export type AgencyLocation = {
  slug: string;
  name: string;
  state: string;
  city: string;
  address: string;
  zip_code: string;
};

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
