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
        url,
        sourcePage: url,
        documentId: z.number().int().positive(),
        documentNumber: text,
        filingDate: date,
        retrievedAt: timestamp,
        sha1: z.string().regex(/^[a-f0-9]{40}$/),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        sha1Verified: z.literal(true),
        confidence: text,
      })
      .strict(),
    model: text,
    generatedAt: date,
    support: z
      .array(
        z
          .object({ paragraph: z.number().int().positive(), pages: text })
          .strict(),
      )
      .min(1),
    publicationStatus: z.literal("internal draft; not published"),
    limitations: text,
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
      .min(1),
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
    ]),
    sourceUrl: url,
    checkedAt: timestamp,
    detail: text,
  })
  .strict();
