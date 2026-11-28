import type { IntakeSource } from "../../../../../src/cli/intake-source.js";
import { acquire } from "./acquire.js";
import { transform } from "./transform.js";

export const source = {
  description:
    "Oregon DPSST public roster, employment history and certifications.",
  produces: [
    "LicensingAuthorities",
    "AuthorityLicenses",
    "Agencies",
    "Personnel",
    "AgencyPersonnel",
    "Licenses",
    "LicenseActions",
    "AgencyPhoneNumbers",
  ],
  acquire,
  transform,
} satisfies IntakeSource;
