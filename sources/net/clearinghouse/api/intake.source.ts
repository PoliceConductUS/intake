import type { IntakeSource } from "../../../../src/cli/intake-source.js";
import { acquire } from "./acquire.js";
import { transform } from "./transform.js";

export const source = {
  description:
    "Civil Rights Litigation Clearinghouse — policing civil cases naming any agency with at least one officer, linked to the officers named as defendants via the run-phase agency_personnel resolver.",
  produces: [
    "CivilCases",
    "CivilCasePersonnel",
    "CivilCaseLinks",
    "LicensingAuthorities",
  ],
  acquire,
  transform,
} satisfies IntakeSource;
