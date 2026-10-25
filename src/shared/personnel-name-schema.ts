import { z } from "zod";

// Name words are not evidence of a fixture. Specific fixtures belong in the
// reason-bearing exclusion ledger, never a lexical blacklist.
export const personnelName = z
  .string()
  .trim()
  .min(1)
  .refine((value) => /\p{Letter}/u.test(value), {
    params: { currentValueOnly: true },
    message:
      "personnel-name-no-letters: identity component must contain a Unicode letter",
  });

// Retain the existing intake vocabulary. Reject unsupported values; do not
// infer III from 111 or silently clear evidence. A correction needs a reason.
const suffixes = new Set([
  "jr",
  "jr.",
  "sr",
  "sr.",
  "i",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
  "vii",
  "viii",
  "ix",
  "x",
]);
export const personnelSuffix = z
  .string()
  .trim()
  .min(1)
  .refine((value) => suffixes.has(value.toLowerCase()), {
    params: { currentValueOnly: true },
    message:
      "personnel-suffix-unsupported: requires a verified generational suffix or an explicit correction",
  });
