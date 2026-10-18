import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const DocumentActionSchema = z.strictObject({
  contactId: z.string().min(1),
  caseNumber: z.string().min(1),
});
const narrative = z.string().nullable();
export const OrderAnalysisSchema = z.strictObject({
  allegation: narrative,
  violation: narrative,
  finding: narrative,
  chief_action: narrative,
  sanction: narrative,
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
  analyzedWith: z.strictObject({
    model: z.string().min(1),
    promptVersion: z.number().int().positive(),
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
