import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  aiComplaintSummary,
  complaintSummaryUnavailability,
} from "../../src/shared/ai-complaint-summary.js";
export const analysisSchema = z
  .object({
    paragraphs: z
      .array(
        z
          .object({
            text: z.string().trim().min(1),
            pages: z.array(z.number().int().positive()).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type ComplaintAnalyzer = {
  model: string;
  promptVersion: string;
  analyze(text: string): Promise<z.infer<typeof analysisSchema>>;
};
export type ComplaintResult = {
  ai_complaint_summary: z.infer<typeof aiComplaintSummary> | null;
  complaint_summary_unavailability: z.infer<
    typeof complaintSummaryUnavailability
  > | null;
};
const API = "https://www.courtlistener.com/api/rest/v4/docket-entries/";
const documentSchema = z.object({
  id: z.number().int().positive(),
  document_number: z.string(),
  attachment_number: z.unknown().optional(),
  description: z.string().nullish(),
  is_available: z.boolean(),
  filepath_local: z.string().nullish(),
  sha1: z.string().nullish(),
  plain_text: z.string().nullish(),
  absolute_url: z.string(),
});
type AcquisitionInput = {
  docketId: string;
  sourceDir: string;
  state: string;
  fetchJson: (url: string) => Promise<Record<string, unknown>>;
  fetchPdf: (url: string) => Promise<Buffer>;
};
type PreparedComplaint =
  | {
      kind: "ready";
      doc: z.infer<typeof documentSchema>;
      date: string;
      url: URL;
      hash: string;
      now: string;
      sourceUrl: string;
      dir: string;
      docketId: string;
    }
  | { kind: "unavailable"; result: ComplaintResult };
export async function prepareComplaint(
  input: AcquisitionInput,
): Promise<PreparedComplaint> {
  if (!/^\d+$/.test(input.docketId))
    throw new Error("Invalid docket identifier");
  const dir = path.join(input.sourceDir, "complaints", input.docketId);
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const sourceUrl = `https://www.courtlistener.com/docket/${input.docketId}/`;
  const entries: Record<string, unknown>[] = [];
  let next: string | null =
    `${API}?docket=${input.docketId}&order_by=entry_number`;
  const seen = new Set<string>();
  while (next) {
    if (!next.startsWith(API + "?") || seen.has(next))
      throw new Error("Invalid docket pagination");
    seen.add(next);
    const page = await input.fetchJson(next);
    entries.push(
      ...z.array(z.record(z.string(), z.unknown())).parse(page.results),
    );
    next = z.string().nullable().parse(page.next);
  }
  await writeFile(
    path.join(dir, "entries.json"),
    JSON.stringify({ retrievedAt: now, entries }, null, 2),
  );
  const candidates = entries
    .flatMap((entry) =>
      z
        .array(z.record(z.string(), z.unknown()))
        .parse(entry.recap_documents)
        .flatMap((raw) => {
          const labels = [raw.description, entry.description];
          const explicitAttachment =
            raw.attachment_number != null &&
            /^(?:(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\s+)?(?:(?:amended|corrected|supplemental)\s+)*complaint\b/i.test(
              String(entry.description ?? "").trim(),
            ) &&
            /^(?:Additional Page\(s\)\s+)?(?:Plaintiff(?:s|['’]s)?\s+)?(?:(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\s+)?(?:(?:amended|corrected|supplemental)\s+)*complaint\s*$/i.test(
              String(raw.description ?? "").trim(),
            );
          if (
            !explicitAttachment &&
            (raw.attachment_number != null ||
              !labels.some((label) =>
                /^(?:(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\s+)?(?:(?:amended|corrected|supplemental)\s+)*complaint\b/i.test(
                  String(label ?? "").trim(),
                ),
              ))
          )
            return [];
          // Some RECAP events retain an empty, unnumbered duplicate alongside
          // the numbered complaint. Exclude only a proven exact-event stub;
          // the untouched entries.json above remains the source evidence.
          const eventKeys = [
            "docket",
            "date_filed",
            "time_filed",
            "recap_sequence_number",
          ];
          const isDuplicateStub =
            entry.entry_number === null &&
            raw.attachment_number == null &&
            raw.is_available === false &&
            [
              "document_number",
              "pacer_doc_id",
              "filepath_local",
              "sha1",
              "absolute_url",
            ].every((key) => raw[key] == null || raw[key] === "") &&
            eventKeys.every(
              (key) => entry[key] != null && String(entry[key]).trim() !== "",
            ) &&
            entries.some(
              (other) =>
                typeof other.entry_number === "number" &&
                Number.isFinite(other.entry_number) &&
                eventKeys.every((key) => other[key] === entry[key]) &&
                z
                  .array(z.record(z.string(), z.unknown()))
                  .parse(other.recap_documents)
                  .some(
                    (otherDoc) =>
                      otherDoc.attachment_number == null &&
                      [otherDoc.description, other.description].some((label) =>
                        /^(?:(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\s+)?(?:(?:amended|corrected|supplemental)\s+)*complaint\b/i.test(
                          String(label ?? "").trim(),
                        ),
                      ),
                  ),
            );
          if (isDuplicateStub) return [];
          return [
            {
              doc: documentSchema.parse(raw),
              date: z.iso.date().parse(entry.date_filed),
              number: z.number().parse(entry.entry_number),
              explicitAttachment,
            },
          ];
        }),
    )
    .sort(
      (a, b) =>
        b.number - a.number ||
        Number(b.explicitAttachment) - Number(a.explicitAttachment),
    );
  const selected = candidates[0];
  const unavailable = async (
    reason: "pending" | "missing_copy",
    detail: string,
  ) => {
    const result: ComplaintResult = {
      ai_complaint_summary: null,
      complaint_summary_unavailability: {
        reason,
        detail,
        sourceUrl,
        checkedAt: now,
      },
    };
    await writeFile(
      path.join(dir, "result.json"),
      JSON.stringify(result, null, 2),
    );
    return { kind: "unavailable" as const, result };
  };
  if (!selected)
    return unavailable(
      "pending",
      "No complaint was identified in the retrieved docket entries.",
    );
  const { doc, date } = selected;
  if (!doc.is_available || !doc.filepath_local)
    return unavailable(
      "missing_copy",
      `The identified complaint document ${doc.document_number} has no available copy in the retrieved source metadata.`,
    );
  if (!/^[a-f0-9]{40}$/.test(doc.sha1 ?? ""))
    throw new Error("Complaint SHA-1 metadata is missing");
  const url = new URL(doc.filepath_local, "https://storage.courtlistener.com/");
  if (url.origin !== "https://storage.courtlistener.com")
    throw new Error("Unexpected complaint storage origin");
  const pdf = await input.fetchPdf(url.href);
  if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw new Error("Complaint response is not a PDF");
  if (createHash("sha1").update(pdf).digest("hex") !== doc.sha1)
    throw new Error("Complaint SHA-1 mismatch");
  const hash = createHash("sha256").update(pdf).digest("hex");
  await writeFile(path.join(dir, "complaint.pdf"), pdf);
  await writeFile(path.join(dir, "complaint.txt"), doc.plain_text ?? "");
  return {
    kind: "ready",
    doc,
    date,
    url,
    hash,
    now,
    sourceUrl,
    dir,
    docketId: input.docketId,
  };
}

export async function finishComplaint(
  prepared: PreparedComplaint,
  input: { state: string; analyzer: ComplaintAnalyzer },
): Promise<ComplaintResult> {
  if (prepared.kind === "unavailable") return prepared.result;
  const { doc, date, url, hash, now, sourceUrl, dir, docketId } = prepared;
  const reviewed = await readReviewedResult(prepared, input);
  if (reviewed) {
    const result = reviewed;
    await writeFile(
      path.join(dir, "result.json"),
      JSON.stringify(result, null, 2),
    );
    return result;
  }
  if (!doc.plain_text?.trim())
    throw new Error("Complaint text extraction is pending");
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        docketId,
        doc.id,
        doc.document_number,
        doc.absolute_url,
        date,
        url.href,
        hash,
        doc.plain_text,
        input.analyzer.model,
        input.analyzer.promptVersion,
      ]),
    )
    .digest("hex");
  const cache = path.join(input.state, "complaint-summaries", key + ".json");
  let summary: z.infer<typeof aiComplaintSummary>;
  try {
    summary = aiComplaintSummary.parse(
      JSON.parse(await readFile(cache, "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const analysis = analysisSchema.parse(
      await input.analyzer.analyze(doc.plain_text),
    );
    const pageCount = doc.plain_text.split("\f").length;
    if (analysis.paragraphs.some((p) => p.pages.some((n) => n > pageCount)))
      throw new Error("Summary cites a nonexistent complaint page");
    summary = aiComplaintSummary.parse({
      summary: analysis.paragraphs.map((p) => p.text).join("\n\n"),
      source: {
        url: url.href,
        sourcePage: new URL(doc.absolute_url, "https://www.courtlistener.com")
          .href,
        documentId: doc.id,
        documentNumber: doc.document_number,
        filingDate: date,
        retrievedAt: now,
        sha1: doc.sha1,
        sha256: hash,
        sha1Verified: true,
        confidence: "AI summary grounded in the cited complaint",
      },
      model: input.analyzer.model,
      generatedAt: now.slice(0, 10),
      support: analysis.paragraphs.map((p, i) => ({
        paragraph: i + 1,
        pages: p.pages.join(", "),
      })),
      publicationStatus: "internal draft; not published",
      limitations:
        "Complaint-grounded summary; source statements remain attributed.",
      proceduralContext: [
        {
          text: `Complaint document ${doc.document_number} filed ${date}.`,
          url: sourceUrl,
          sourceDate: date,
          retrievedAt: now,
          confidence: "Retrieved docket metadata",
        },
      ],
    });
    await mkdir(path.dirname(cache), { recursive: true });
    await writeFile(cache, JSON.stringify(summary, null, 2));
  }
  const result = {
    ai_complaint_summary: summary,
    complaint_summary_unavailability: null,
  };
  await writeFile(
    path.join(dir, "result.json"),
    JSON.stringify(result, null, 2),
  );
  return result;
}

export async function acquireComplaintSummary(
  input: AcquisitionInput & { analyzer: ComplaintAnalyzer },
): Promise<ComplaintResult> {
  return finishComplaint(await prepareComplaint(input), input);
}
const extractionSchema = z
  .object({
    method: z.string().trim().min(1),
    text: z
      .string()
      .min(1)
      .refine((text) => text.trim().length > 0),
  })
  .strict();
const reviewSchema = z
  .object({
    summary: aiComplaintSummary,
    extraction: extractionSchema.optional(),
    receipt: z
      .object({
        method: z.literal("codex-document-review"),
        recordedAt: z.iso.datetime({ offset: true }),
        promptVersion: z.string().min(1),
        sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
        textSha256: z.string().regex(/^[a-f0-9]{64}$/),
        paragraphEvidence: aiComplaintSummary.shape.support,
      })
      .strict(),
  })
  .strict();
async function readReviewedResult(
  prepared: Extract<PreparedComplaint, { kind: "ready" }>,
  input: { state: string; analyzer: ComplaintAnalyzer },
) {
  const file = path.join(
    input.state,
    "complaint-reviews",
    `${prepared.doc.id}-${prepared.hash}.json`,
  );
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const review = z
    .union([reviewSchema, unavailabilityReviewSchema])
    .parse(JSON.parse(content));
  let result: ComplaintResult;
  if ("unavailability" in review) {
    validateUnavailabilityReview(
      prepared,
      input.analyzer.promptVersion,
      review,
    );
    result = {
      ai_complaint_summary: null,
      complaint_summary_unavailability: review.unavailability,
    };
  } else {
    validateReview(prepared, input.analyzer.promptVersion, review);
    result = {
      ai_complaint_summary: review.summary,
      complaint_summary_unavailability: null,
    };
  }
  await writeFile(path.join(prepared.dir, "review.json"), content);
  return result;
}

function validateReview(
  prepared: Extract<PreparedComplaint, { kind: "ready" }>,
  promptVersion: string,
  review: z.infer<typeof reviewSchema>,
) {
  const { summary, receipt } = review;
  const text = review.extraction?.text ?? prepared.doc.plain_text ?? "";
  if (
    !text.trim() ||
    receipt.promptVersion !== promptVersion ||
    receipt.sourceSha256 !== prepared.hash ||
    receipt.textSha256 !== createHash("sha256").update(text).digest("hex") ||
    summary.source.sourcePage !==
      new URL(prepared.doc.absolute_url, "https://www.courtlistener.com").href
  )
    throw new Error(
      "Complaint review does not match the acquired evidence or current contract",
    );
}
export async function recordComplaintReview(
  prepared: PreparedComplaint,
  state: string,
  summary: unknown,
  promptVersion: string,
  extraction?: z.infer<typeof extractionSchema>,
): Promise<void> {
  if (prepared.kind !== "ready")
    throw new Error("A verified complaint is required to record a review");
  const parsed = aiComplaintSummary.parse(summary);
  const review = reviewSchema.parse({
    summary: parsed,
    ...(extraction ? { extraction } : {}),
    receipt: {
      method: "codex-document-review",
      recordedAt: new Date().toISOString(),
      promptVersion,
      sourceSha256: prepared.hash,
      textSha256: createHash("sha256")
        .update(extraction?.text ?? prepared.doc.plain_text ?? "")
        .digest("hex"),
      paragraphEvidence: parsed.support,
    },
  });
  validateReview(prepared, promptVersion, review);
  const dir = path.join(state, "complaint-reviews");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${prepared.doc.id}-${prepared.hash}.json`),
    JSON.stringify(review, null, 2),
  );
}

const unavailabilityReviewSchema = z
  .object({
    unavailability: complaintSummaryUnavailability.extend({
      reason: z.literal("available_unsummarized"),
    }),
    source: aiComplaintSummary.shape.source
      .pick({
        documentId: true,
        documentNumber: true,
        sourcePage: true,
        url: true,
        filingDate: true,
        sha1: true,
        sha256: true,
      })
      .extend({ docketId: z.string().regex(/^\d+$/) }),
    receipt: z
      .object({
        method: z.literal("codex-document-review"),
        recordedAt: z.iso.datetime({ offset: true }),
        promptVersion: z.string().min(1),
      })
      .strict(),
  })
  .strict();

function unavailabilitySource(
  prepared: Extract<PreparedComplaint, { kind: "ready" }>,
) {
  return {
    docketId: prepared.docketId,
    documentId: prepared.doc.id,
    documentNumber: prepared.doc.document_number,
    sourcePage: new URL(
      prepared.doc.absolute_url,
      "https://www.courtlistener.com",
    ).href,
    url: prepared.url.href,
    filingDate: prepared.date,
    sha1: prepared.doc.sha1,
    sha256: prepared.hash,
  };
}

function validateUnavailabilityReview(
  prepared: Extract<PreparedComplaint, { kind: "ready" }>,
  promptVersion: string,
  review: z.infer<typeof unavailabilityReviewSchema>,
) {
  const source = unavailabilitySource(prepared);
  if (
    review.receipt.promptVersion !== promptVersion ||
    review.unavailability.sourceUrl !== prepared.url.href ||
    (Object.keys(source) as Array<keyof typeof source>).some(
      (key) => review.source[key] !== source[key],
    )
  )
    throw new Error(
      "Complaint unavailability review does not match the acquired evidence or current contract",
    );
}

export async function recordComplaintUnavailability(
  prepared: PreparedComplaint,
  state: string,
  unavailability: unknown,
  promptVersion: string,
): Promise<void> {
  if (prepared.kind !== "ready")
    throw new Error("A verified complaint is required to record a review");
  const review = unavailabilityReviewSchema.parse({
    unavailability,
    source: unavailabilitySource(prepared),
    receipt: {
      method: "codex-document-review",
      recordedAt: new Date().toISOString(),
      promptVersion,
    },
  });
  validateUnavailabilityReview(prepared, promptVersion, review);
  const dir = path.join(state, "complaint-reviews");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${prepared.doc.id}-${prepared.hash}.json`),
    JSON.stringify(review, null, 2),
  );
}
