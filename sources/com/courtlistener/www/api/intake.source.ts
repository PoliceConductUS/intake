import type { IntakeSource } from "../../../../../src/cli/intake-source.js";
import { acquire } from "./acquire.js";
import { transform } from "./transform.js";

export const source = {
  description:
    "CourtListener — federal dockets naming any U.S. agency with at least one officer (active or not), linked to any officer named as a party (plaintiff or defendant) via the fuzzy agency_personnel resolver.",
  produces: [
    "CivilCases",
    "CivilCasePersonnel",
    "CivilCaseLinks",
    "LicensingAuthorities",
  ],
  acquire,
  transform,
} satisfies IntakeSource;
