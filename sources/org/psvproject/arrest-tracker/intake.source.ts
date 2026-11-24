import type { IntakeSource } from "../../../../src/cli/intake-source.js";
import { acquire } from "./acquire.js";
import { transform } from "./transform.js";

export const source = {
  description:
    "Spreadsheet-linked reporting, associated with named officers through article-supported agency identities.",
  produces: ["CoverageLinks", "CoverageLinkAgencyPersonnel"],
  acquire,
  transform,
} satisfies IntakeSource;
