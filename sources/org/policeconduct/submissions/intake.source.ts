import type { IntakeSource } from "../../../../src/cli/intake-source.js";
import { acquire } from "./acquire.js";
import { transform } from "./transform.js";

export const source = {
  produces: ["Reviews", "ReviewPersonnel"],
  standalone: true,
  acquire,
  transform,
} satisfies IntakeSource;
