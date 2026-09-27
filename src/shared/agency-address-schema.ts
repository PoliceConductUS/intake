import { z } from "zod";

const addressPlaceholders = new Set([
  "null",
  "0",
  "x",
  "xx",
  "-----",
  "n/a",
  "test",
]);

export const agencyAddressText = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !addressPlaceholders.has(value.toLowerCase()), {
    message: "Agency city and address must not be placeholder values.",
  });

export const agencyZipCode = z
  .string()
  .trim()
  .regex(
    /^(?!00000)\d{5}(?:-\d{4})?$/,
    "Agency ZIP must be five digits or ZIP+4, with a nonzero five-digit ZIP.",
  );
