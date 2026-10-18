import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const DocumentActionSchema = z.strictObject({
  contactId: z.string().min(1),
  caseNumber: z.string().min(1),
});
export const ORDER_ANALYSIS_PROMPT_VERSION = 2;
const narrative = z.string().trim().min(1).nullable();
export const OrderAnalysisSchema = z.strictObject({
  allegation: narrative,
  violation: narrative,
  finding: narrative,
  chief_action: narrative,
  sanction: narrative,
});
export const AbsenceReasonsSchema = z.strictObject({
  allegation: z.string().trim().min(1).optional(),
  violation: z.string().trim().min(1).optional(),
  finding: z.string().trim().min(1).optional(),
  chief_action: z.string().trim().min(1).optional(),
  sanction: z.string().trim().min(1).optional(),
});
export const OrderAnalysisResultSchema = z
  .strictObject({
    analysis: OrderAnalysisSchema,
    absenceReasons: AbsenceReasonsSchema,
  })
  .superRefine(({ analysis, absenceReasons }, ctx) => {
    for (const field of Object.keys(analysis) as Array<keyof typeof analysis>) {
      const hasReason = Object.hasOwn(absenceReasons, field);
      if (
        analysis[field] === null
          ? typeof absenceReasons[field] !== "string" ||
            absenceReasons[field]!.trim() === ""
          : hasReason
      )
        ctx.addIssue({
          code: "custom",
          path: ["absenceReasons", field],
          message:
            analysis[field] === null
              ? `Null ${field} requires an explicit absence reason`
              : `Populated ${field} must not have an absence reason`,
        });
    }
  });
const page = z.strictObject({
  page: z.number().int().positive(),
  method: z.enum(["text", "ocr"]),
  text: z.string(),
});
const fieldEvidence = z.array(
  z.strictObject({
    page: z.number().int().positive(),
    excerpt: z.string().min(1),
  }),
);
const DocumentSchema = z.strictObject({
  url: z.string().min(1),
  documentName: z.string().nullable(),
  actions: z.array(DocumentActionSchema).min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
  fetchedAt: z.string().min(1),
  pages: z.array(page).min(1),
  text: z.string(),
  analysis: OrderAnalysisSchema,
  absenceReasons: AbsenceReasonsSchema,
  analyzedWith: z.strictObject({
    model: z.string().min(1),
    promptVersion: z.literal(ORDER_ANALYSIS_PROMPT_VERSION),
  }),
  reviewReceipt: z
    .strictObject({
      method: z.literal("codex-document-review"),
      reviewedAt: z.string().min(1),
      fieldEvidence: z.strictObject({
        allegation: fieldEvidence,
        violation: fieldEvidence,
        finding: fieldEvidence,
        chief_action: fieldEvidence,
        sanction: fieldEvidence,
      }),
    })
    .optional(),
});
const PreviousDocumentSchema = DocumentSchema.omit({
  absenceReasons: true,
}).extend({
  analysis: z.strictObject({
    allegation: z.string().nullable(),
    violation: z.string().nullable(),
    finding: z.string().nullable(),
    chief_action: z.string().nullable(),
    sanction: z.string().nullable(),
  }),
  analyzedWith: z.strictObject({
    model: z.string().min(1),
    promptVersion: z.literal(1),
  }),
});

export async function readPriorDocumentEvidence(jsonPath: string) {
  const document = PreviousDocumentSchema.parse(
    JSON.parse(await readFile(jsonPath, "utf8")),
  );
  await verifyPreservedDocument(jsonPath, document);
  return document;
}

export const UnavailableDocumentSchema = z.strictObject({
  url: z.string().min(1),
  actions: z.array(DocumentActionSchema).min(1),
  reason: z.string().trim().min(1),
});

/** Validate completed analysis against the preserved PDF and its extracted page evidence. */
export async function readDocumentEvidence(jsonPath: string) {
  const document = DocumentSchema.parse(
    JSON.parse(await readFile(jsonPath, "utf8")),
  );
  OrderAnalysisResultSchema.parse({
    analysis: document.analysis,
    absenceReasons: document.absenceReasons,
  });
  await verifyPreservedDocument(jsonPath, document);
  if (
    document.analyzedWith.model === "codex-document-review" &&
    document.reviewReceipt === undefined
  )
    throw new Error(`mn-post document review receipt missing: ${jsonPath}`);
  if (document.reviewReceipt !== undefined) {
    for (const [field, entries] of Object.entries(
      document.reviewReceipt.fieldEvidence,
    )) {
      if (
        document.analysis[field as keyof typeof document.analysis] !== null &&
        entries.length === 0
      )
        throw new Error(
          `mn-post document review evidence missing for ${field}: ${jsonPath}`,
        );
      for (const entry of entries)
        if (
          !document.pages.some(
            (p) => p.page === entry.page && p.text.includes(entry.excerpt),
          )
        )
          throw new Error(
            `mn-post document review excerpt does not match page: ${jsonPath}`,
          );
    }
  }
  return document;
}

async function verifyPreservedDocument(
  jsonPath: string,
  document: {
    sha256: string;
    bytes: number;
    pages: Array<{ text: string }>;
    text: string;
  },
): Promise<void> {
  const pdfPath = jsonPath.replace(/\.document\.json$/i, ".pdf");
  const bytes = await readFile(pdfPath);
  if (
    bytes.length !== document.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== document.sha256
  )
    throw new Error(
      `mn-post document evidence does not match PDF: ${path.basename(jsonPath)}`,
    );
  if (
    document.pages
      .map((p) => p.text.trim())
      .filter(Boolean)
      .join("\n\n") !== document.text
  )
    throw new Error(`mn-post document text does not match pages: ${jsonPath}`);
}
