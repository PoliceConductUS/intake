import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { acquireComplaintSummary } from "../../../sources/courtlistener/summary-acquisition.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
const pdf = Buffer.from("%PDF-1.7 synthetic complaint");
const doc = {
  id: 123,
  document_number: "1",
  attachment_number: null,
  description: "COMPLAINT",
  is_available: true,
  filepath_local: "recap/example.pdf",
  sha1: createHash("sha1").update(pdf).digest("hex"),
  plain_text: "Complaint page one\fComplaint page two",
  absolute_url: "/docket/12/1/example/",
};
async function setup(entries: unknown[]) {
  const root = await mkdtemp(path.join(tmpdir(), "complaint-"));
  dirs.push(root);
  const analyze = vi.fn(async () => ({
    paragraphs: [
      { text: "The plaintiff alleges an unlawful arrest.", pages: [1, 2] },
    ],
  }));
  const fetchJson = vi.fn(async () => ({ results: entries, next: null }));
  const fetchPdf = vi.fn(async () => pdf);
  return {
    root,
    args: {
      docketId: "12",
      sourceDir: path.join(root, "output"),
      state: path.join(root, "state"),
      fetchJson,
      fetchPdf,
      analyzer: { model: "synthetic", promptVersion: "1", analyze },
    },
    analyze,
    fetchJson,
    fetchPdf,
  };
}
test("retains verified complaint and reuses analysis on acquisition rerun", async () => {
  const s = await setup([
    {
      entry_number: 1,
      date_filed: "2025-01-01",
      description: "COMPLAINT",
      recap_documents: [doc],
    },
  ]);
  const a = await acquireComplaintSummary(s.args);
  const b = await acquireComplaintSummary(s.args);
  expect(a.ai_complaint_summary?.summary).toContain("unlawful arrest");
  expect(a.ai_complaint_summary?.support).toEqual([
    { paragraph: 1, pages: "1, 2" },
  ]);
  expect(b.ai_complaint_summary).toEqual(a.ai_complaint_summary);
  expect(s.analyze).toHaveBeenCalledTimes(1);
  expect(
    await readFile(path.join(s.args.sourceDir, "complaints/12/complaint.pdf")),
  ).toEqual(pdf);
});
test("selects unavailable amended complaint from later page instead of older available copy", async () => {
  const s = await setup([]);
  s.fetchJson
    .mockResolvedValueOnce({
      results: [
        { entry_number: 1, date_filed: "2025-01-01", recap_documents: [doc] },
      ],
      next: "https://www.courtlistener.com/api/rest/v4/docket-entries/?page=2",
    } as never)
    .mockResolvedValueOnce({
      results: [
        {
          entry_number: 3,
          date_filed: "2025-02-01",
          recap_documents: [
            {
              ...doc,
              id: 124,
              description: "AMENDED COMPLAINT",
              is_available: false,
            },
          ],
        },
      ],
      next: null,
    });
  const result = await acquireComplaintSummary(s.args);
  expect(result.complaint_summary_unavailability?.reason).toBe("missing_copy");
  expect(s.analyze).not.toHaveBeenCalled();
});
test("rejects hash mismatch before analysis", async () => {
  const s = await setup([
    {
      entry_number: 1,
      date_filed: "2025-01-01",
      recap_documents: [{ ...doc, sha1: "0".repeat(40) }],
    },
  ]);
  await expect(acquireComplaintSummary(s.args)).rejects.toThrow("SHA-1");
  expect(s.analyze).not.toHaveBeenCalled();
});
test("unidentified complaint is pending, not missing", async () => {
  const s = await setup([]);
  expect(
    (await acquireComplaintSummary(s.args)).complaint_summary_unavailability
      ?.reason,
  ).toBe("pending");
});
test("retains the available PDF even when extracted text is absent", async () => {
  const s = await setup([
    {
      entry_number: 1,
      date_filed: "2025-01-01",
      recap_documents: [{ ...doc, plain_text: "" }],
    },
  ]);
  await expect(acquireComplaintSummary(s.args)).rejects.toThrow(
    "text extraction",
  );
  expect(
    await readFile(path.join(s.args.sourceDir, "complaints/12/complaint.pdf")),
  ).toEqual(pdf);
  expect(s.analyze).not.toHaveBeenCalled();
});
test("rejects invented page references", async () => {
  const s = await setup([
    { entry_number: 1, date_filed: "2025-01-01", recap_documents: [doc] },
  ]);
  s.analyze.mockResolvedValue({
    paragraphs: [{ text: "An allegation.", pages: [99] }],
  });
  await expect(acquireComplaintSummary(s.args)).rejects.toThrow("nonexistent");
});
test("does not follow pagination onto another host", async () => {
  const s = await setup([]);
  s.fetchJson.mockResolvedValueOnce({
    results: [],
    next: "https://example.org/steal-token",
  } as never);
  await expect(acquireComplaintSummary(s.args)).rejects.toThrow("pagination");
  expect(s.fetchJson).toHaveBeenCalledTimes(1);
});

test("reuses a hash-bound reviewed summary without calling the configured model", async () => {
  const s = await setup([
    { entry_number: 1, date_filed: "2025-01-01", recap_documents: [doc] },
  ]);
  const first = await acquireComplaintSummary(s.args);
  const summary = first.ai_complaint_summary!;
  const dir = path.join(s.args.state, "complaint-reviews");
  await mkdir(dir, { recursive: true });
  const receipt = {
    method: "codex-document-review",
    recordedAt: new Date().toISOString(),
    promptVersion: "1",
    sourceSha256: summary.source.sha256,
    textSha256: createHash("sha256").update(doc.plain_text).digest("hex"),
    paragraphEvidence: summary.support,
  };
  await writeFile(
    path.join(dir, `123-${summary.source.sha256}.json`),
    JSON.stringify({ summary, receipt }),
  );
  s.args.analyzer.model = "different-provider";
  s.analyze.mockRejectedValue(new Error("Must not call model"));
  expect((await acquireComplaintSummary(s.args)).ai_complaint_summary).toEqual(
    summary,
  );
  expect(s.analyze).toHaveBeenCalledTimes(1);
  receipt.textSha256 = "0".repeat(64);
  await writeFile(
    path.join(dir, `123-${summary.source.sha256}.json`),
    JSON.stringify({ summary, receipt }),
  );
  await expect(acquireComplaintSummary(s.args)).rejects.toThrow("review");
});
