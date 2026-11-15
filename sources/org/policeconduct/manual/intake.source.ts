import type { IntakeSource } from "../../../../src/cli/intake-source.js";
import { PRODUCES } from "./kinds.js";
import { acquire } from "./acquire.js";
import { transform } from "./transform.js";

export const source = {
  produces: PRODUCES,
  standalone: true,
  acquire,
  transform,
} satisfies IntakeSource;
