import type { IntakeSource } from "../../../../../src/cli/intake-source.js";
import { transform } from "./transform.js";

export const source = {
  description:
    "Arizona POST roster — disabled (produces no agency-linked personnel yet).",
  produces: [],
  transform,
} satisfies IntakeSource;
