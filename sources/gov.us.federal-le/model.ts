export const ORGS_FILE = "federal-agencies.yaml";
export const OFFICES_FILE = "offices.yaml";

export type Org = {
  slug: string;
  name: string;
};

export type Office = {
  federal_agency: string;
  slug: string;
  name: string;
  state: string;
  city: string;
  address: string;
  zip_code: string;
};

export function mergeOrgs(
  existing: readonly Org[],
  discovered: readonly Org[],
): { orgs: Org[]; added: string[] } {
  const bySlug = new Map(existing.map((org) => [org.slug, org]));
  const added: string[] = [];
  for (const org of discovered) {
    if (bySlug.has(org.slug)) continue;
    bySlug.set(org.slug, org);
    added.push(org.slug);
  }
  const orgs = [...bySlug.values()].sort((left, right) =>
    left.slug.localeCompare(right.slug),
  );
  return { orgs, added };
}

export function officeIsComplete(office: Office): boolean {
  return (
    (office.federal_agency ?? "").trim() !== "" &&
    (office.slug ?? "").trim() !== "" &&
    (office.name ?? "").trim() !== "" &&
    (office.state ?? "").trim() !== "" &&
    (office.city ?? "").trim() !== "" &&
    (office.address ?? "").trim() !== "" &&
    (office.zip_code ?? "").trim() !== ""
  );
}
