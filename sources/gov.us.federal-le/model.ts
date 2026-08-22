export const ORGS_FILE = "federal-agencies.yaml";
export const CANDIDATES_FILE = "federal-agencies.candidates.yaml";
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
