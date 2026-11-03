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
export async function acquireComplaintSummary(input: {
  docketId: string;
  sourceDir: string;
  state: string;
  fetchJson: (url: string) => Promise<Record<string, unknown>>;
  fetchPdf: (url: string) => Promise<Buffer>;
  analyzer: ComplaintAnalyzer;
}): Promise<ComplaintResult> {
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
          const label = String(
            raw.description || entry.description || "",
          ).trim();
          if (
            raw.attachment_number != null ||
            !/^(?:(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\s+)?(?:(?:amended|corrected|supplemental)\s+)*complaint\b/i.test(
              label,
            )
          )
            return [];
          return [
            {
              doc: documentSchema.parse(raw),
              date: z.iso.date().parse(entry.date_filed),
              number: z.number().parse(entry.entry_number),
            },
          ];
        }),
    )
    .sort((a, b) => b.number - a.number);
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
    return result;
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
  if (!doc.plain_text?.trim())
    throw new Error("Complaint text extraction is pending");
  await writeFile(path.join(dir, "complaint.txt"), doc.plain_text);
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        input.docketId,
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
