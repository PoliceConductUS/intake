import type { IntakeSource } from "../../../../src/cli/intake-source.js";
import { transform } from "./transform.js";

export const source = {
  description:
    "Texas TCOLE — agencies, officers, licenses, and assignments reconstructed from the TCOLE public-information workbook.",
  produces: [
    "LicensingAuthorities",
    "AuthorityLicenses",
    "Agencies",
    "Personnel",
    "Licenses",
    "LicenseActions",
    "AgencyPersonnel",
    "AgencyPhoneNumbers",
  ],
  transform,
} satisfies IntakeSource;
