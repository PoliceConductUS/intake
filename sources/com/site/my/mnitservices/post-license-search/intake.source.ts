import type { IntakeSource } from "../../../../../../src/cli/intake-source.js";
import { acquire } from "./acquire.js";
import { transform } from "./transform.js";

export const source = {
  description:
    "Minnesota POST — agencies, officers, licenses, and disciplinary/coverage records from the MN POST license-lookup rosters.",
  produces: [
    "LicensingAuthorities",
    "AuthorityLicenses",
    "Agencies",
    "Personnel",
    "PersonnelEducations",
    "Licenses",
    "AgencyPersonnel",
    "Disciplines",
    "DisciplineAgencyPersonnel",
    "CoverageLinks",
    "CoverageLinkAgencyPersonnel",
  ],
  acquire,
  transform,
} satisfies IntakeSource;
