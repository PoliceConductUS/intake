import { z } from "zod";

const text = z.string().trim().min(1);
const url = z.url({ protocol: /^https?$/ });
const date = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });

export const aiComplaintSummary = z
  .object({
    summary: text,
    source: z
      .object({
        url: url.optional(),
        sourcePage: url,
        documentId: z.number().int().positive().optional(),
        documentNumber: text.optional(),
        filingDate: date.optional(),
        retrievedAt: timestamp.optional(),
        sha1: z
          .string()
          .regex(/^[a-f0-9]{40}$/)
          .optional(),
        sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        sha1Verified: z.boolean().optional(),
        confidence: text.optional(),
      })
      .strict(),
    model: text.optional(),
    generatedAt: date.optional(),
    support: z
      .array(
        z
          .object({ paragraph: z.number().int().positive(), pages: text })
          .strict(),
      )
      .optional(),
    publicationStatus: text.optional(),
    limitations: text.optional(),
    proceduralContext: z
      .array(
        z
          .object({
            text,
            url,
            sourceDate: date,
            retrievedAt: timestamp,
            confidence: text,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const complaintSummaryUnavailability = z
  .object({
    reason: z.enum([
      "missing_copy",
      "pending",
      "retrieval_failed",
      "authentication_failed",
      "generation_failed",
      "available_unsummarized",
    ]),
    sourceUrl: url,
    checkedAt: timestamp,
    detail: text,
  })
  .strict();
