import type { IntakeSource } from "../../../../src/cli/intake-source.js";
import { acquire } from "./acquire.js";
import { transform } from "./transform.js";

export const source = {
  produces: ["ArrestProfiles", "AgencyArrestProfiles"],
  acquire,
  transform,
} satisfies IntakeSource;
