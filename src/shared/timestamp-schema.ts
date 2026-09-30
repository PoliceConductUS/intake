import { z } from "zod";

export const timestampWithTimezone = z
  .string()
  .trim()
  .regex(
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/,
    "Timestamp requires an explicit timezone (Z or a numeric UTC offset).",
  )
  .refine((value) => z.iso.date().safeParse(value.slice(0, 10)).success, {
    message: "Timestamp requires a valid calendar date.",
  });
