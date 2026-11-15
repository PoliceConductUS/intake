import type { IntakeSource } from "../../../../../src/cli/intake-source.js";
import { acquire } from "./acquire.js";
import { transform } from "./transform.js";

export const source = {
  description:
    "US federal law-enforcement agencies — each agency (FBI, DEA, …) as a federal_agency, its offices (HQ + field offices) as agency records. Agencies are discovered from Wikipedia; offices are curated in state.",
  produces: ["FederalAgencies", "Agencies"],
  acquire,
  transform,
} satisfies IntakeSource;
