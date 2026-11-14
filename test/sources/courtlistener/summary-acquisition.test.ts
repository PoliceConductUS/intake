import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import {
  acquireComplaintSummary,
  prepareComplaint,
  recordComplaintReview,
} from "../../../sources/courtlistener/summary-acquisition.js";
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
test("recognizes an amended complaint from the entry despite a generic document label", async () => {
  const s = await setup([
    { entry_number: 1, date_filed: "2025-01-01", recap_documents: [doc] },
    {
      entry_number: 12,
      date_filed: "2025-02-01",
      description: "FIRST AMENDED COMPLAINT by Plaintiff",
      recap_documents: [
        {
          ...doc,
          id: 124,
          document_number: "12",
          description: "Amended Document (NOT Motion)",
          is_available: false,
        },
      ],
    },
  ]);
  const result = await acquireComplaintSummary(s.args);
  expect(result.ai_complaint_summary).toBeNull();
  expect(result.complaint_summary_unavailability?.reason).toBe("missing_copy");
  expect(s.fetchPdf).not.toHaveBeenCalled();
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

test("records and reuses a reviewed summary with only text and complaint link", async () => {
  const s = await setup([
    { entry_number: 1, date_filed: "2025-01-01", recap_documents: [doc] },
  ]);
  const prepared = await prepareComplaint(s.args);
  const summary = {
    summary: "The plaintiff alleges an unlawful arrest.",
    source: {
      sourcePage: "https://www.courtlistener.com/docket/12/1/example/",
    },
  };
  await recordComplaintReview(prepared, s.args.state, summary, "1");
  expect((await acquireComplaintSummary(s.args)).ai_complaint_summary).toEqual(
    summary,
  );
  expect(s.analyze).not.toHaveBeenCalled();
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

test("replays a locally extracted review while preserving empty API text", async () => {
  const { prepareComplaint, recordComplaintReview } =
    await import("../../../sources/courtlistener/summary-acquisition.js");
  const s = await setup([
    { entry_number: 1, date_filed: "2025-01-01", recap_documents: [doc] },
  ]);
  const summary = (await acquireComplaintSummary(s.args)).ai_complaint_summary!;
  s.fetchJson.mockResolvedValue({
    results: [
      {
        entry_number: 1,
        date_filed: "2025-01-01",
        recap_documents: [{ ...doc, plain_text: "" }],
      },
    ],
    next: null,
  });
  const prepared = await prepareComplaint(s.args);
  await recordComplaintReview(prepared, s.args.state, summary, "1", {
    method: "pdftotext",
    text: doc.plain_text,
  });
  s.analyze.mockRejectedValue(new Error("Must not call model"));
  expect((await acquireComplaintSummary(s.args)).ai_complaint_summary).toEqual(
    summary,
  );
  expect(
    await readFile(
      path.join(s.args.sourceDir, "complaints/12/complaint.txt"),
      "utf8",
    ),
  ).toBe("");
  const file = path.join(
    s.args.state,
    "complaint-reviews",
    `123-${summary.source.sha256}.json`,
  );
  const review = JSON.parse(await readFile(file, "utf8"));
  expect(review.extraction).toEqual({
    method: "pdftotext",
    text: doc.plain_text,
  });
  review.extraction.text += " altered";
  await writeFile(file, JSON.stringify(review));
  await expect(acquireComplaintSummary(s.args)).rejects.toThrow("review");
});

test("selects explicitly labelled complaint attachment, not generic main or parties list", async () => {
  const s = await setup([
    {
      entry_number: 7,
      date_filed: "2025-02-01",
      description: "AMENDED COMPLAINT filed by Plaintiff",
      recap_documents: [
        {
          ...doc,
          id: 200,
          description: "Amended Document (NOT Motion)",
          filepath_local: "recap/summons.pdf",
        },
        {
          ...doc,
          id: 201,
          attachment_number: 2,
          description:
            "Additional Page(s) Plaintiff's First Amended Complaint - Parties to Suit",
          filepath_local: "recap/parties.pdf",
        },
        {
          ...doc,
          id: 202,
          attachment_number: 1,
          description: "Additional Page(s) Plaintiff's First Amended Complaint",
          filepath_local: "recap/actual-complaint.pdf",
        },
      ],
    },
  ]);
  await acquireComplaintSummary(s.args);
  expect(s.fetchPdf).toHaveBeenCalledWith(
    "https://storage.courtlistener.com/recap/actual-complaint.pdf",
  );
});

test("withholds older complaint when newer explicit attachment has no copy", async () => {
  const s = await setup([
    { entry_number: 1, date_filed: "2025-01-01", recap_documents: [doc] },
    {
      entry_number: 7,
      date_filed: "2025-02-01",
      description: "AMENDED COMPLAINT",
      recap_documents: [
        { ...doc, description: "Amended Document" },
        {
          ...doc,
          id: 202,
          attachment_number: 1,
          description: "First Amended Complaint",
          is_available: false,
        },
      ],
    },
  ]);
  const result = await acquireComplaintSummary(s.args);
  expect(result.complaint_summary_unavailability?.reason).toBe("missing_copy");
  expect(s.fetchPdf).not.toHaveBeenCalled();
});
test("does not inherit complaint entry label onto an exhibit attachment", async () => {
  const s = await setup([
    {
      entry_number: 7,
      date_filed: "2025-02-01",
      description: "COMPLAINT",
      recap_documents: [
        { ...doc, attachment_number: 1, description: "Exhibit A" },
      ],
    },
  ]);
  const result = await acquireComplaintSummary(s.args);
  expect(result.complaint_summary_unavailability?.reason).toBe("pending");
  expect(s.fetchPdf).not.toHaveBeenCalled();
});

test("does not promote proposed complaint attached to motion for leave", async () => {
  const s = await setup([
    {
      entry_number: 1,
      date_filed: "2025-01-01",
      description: "COMPLAINT",
      recap_documents: [doc],
    },
    {
      entry_number: 7,
      date_filed: "2025-02-01",
      description: "MOTION for Leave to File Amended Complaint",
      recap_documents: [
        {
          ...doc,
          id: 202,
          attachment_number: 1,
          description: "Amended Complaint",
          filepath_local: "recap/proposed.pdf",
        },
      ],
    },
  ]);
  await acquireComplaintSummary(s.args);
  expect(s.fetchPdf).toHaveBeenCalledWith(
    "https://storage.courtlistener.com/recap/example.pdf",
  );
});

const complaintEvent = {
  docket: 12,
  date_filed: "2025-01-01",
  time_filed: "16:07:05",
  recap_sequence_number: "2025-01-01.001",
};
const duplicateStub = {
  ...complaintEvent,
  entry_number: null,
  description: "",
  recap_documents: [
    {
      ...doc,
      id: 124,
      document_number: "",
      is_available: false,
      filepath_local: null,
      sha1: "",
      absolute_url: "",
      pacer_doc_id: "",
      plain_text: "",
    },
  ],
};
test("excludes an exact-event empty duplicate stub and retains raw evidence", async () => {
  const entries = [
    duplicateStub,
    {
      ...complaintEvent,
      entry_number: 1,
      description: "COMPLAINT",
      recap_documents: [doc],
    },
  ];
  const s = await setup(entries);
  const result = await acquireComplaintSummary(s.args);
  expect(result.ai_complaint_summary?.summary).toContain("unlawful arrest");
  const retained = JSON.parse(
    await readFile(
      path.join(s.args.sourceDir, "complaints/12/entries.json"),
      "utf8",
    ),
  );
  expect(retained.entries).toEqual(entries);
});
test.each([
  { time_filed: "16:08:05" },
  { docket: 13 },
  { date_filed: "2025-01-02" },
  { recap_sequence_number: "2025-01-01.002" },
  { time_filed: "" },
])(
  "fails closed for a stub with distinct or incomplete event identity %j",
  async (change) => {
    const s = await setup([
      { ...duplicateStub, ...change },
      {
        ...complaintEvent,
        entry_number: 1,
        description: "COMPLAINT",
        recap_documents: [doc],
      },
    ]);
    await expect(acquireComplaintSummary(s.args)).rejects.toThrow();
  },
);

const unsummarized = {
  reason: "available_unsummarized",
  sourceUrl: "https://storage.courtlistener.com/recap/example.pdf",
  checkedAt: "2026-11-03T00:00:00Z",
  detail: "Verified complaint cannot be reliably summarized.",
};
test.each(["", doc.plain_text])(
  "replays a source-bound unsummarized disposition without analysis for text %j",
  async (plain_text) => {
    const { prepareComplaint, recordComplaintUnavailability } =
      await import("../../../sources/courtlistener/summary-acquisition.js");
    const s = await setup([
      {
        entry_number: 1,
        date_filed: "2025-01-01",
        recap_documents: [{ ...doc, plain_text }],
      },
    ]);
    const prepared = await prepareComplaint(s.args);
    await recordComplaintUnavailability(
      prepared,
      s.args.state,
      unsummarized,
      "1",
    );
    s.analyze.mockRejectedValue(new Error("Must not call model"));
    const expected = {
      ai_complaint_summary: null,
      complaint_summary_unavailability: unsummarized,
    };
    expect(await acquireComplaintSummary(s.args)).toEqual(expected);
    expect(await acquireComplaintSummary(s.args)).toEqual(expected);
    expect(
      JSON.parse(
        await readFile(
          path.join(s.args.sourceDir, "complaints/12/result.json"),
          "utf8",
        ),
      ),
    ).toEqual(expected);
    expect(
      JSON.parse(
        await readFile(
          path.join(s.args.sourceDir, "complaints/12/review.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ unavailability: unsummarized });
    expect(s.analyze).not.toHaveBeenCalled();
  },
);
test.each([
  ["docketId", "13"],
  ["documentId", 124],
  ["documentNumber", "2"],
  ["sourcePage", "https://www.courtlistener.com/docket/13/1/other/"],
  ["url", "https://storage.courtlistener.com/recap/other.pdf"],
  ["filingDate", "2025-01-02"],
  ["sha1", "0".repeat(40)],
  ["sha256", "0".repeat(64)],
])(
  "rejects an unsummarized receipt with altered source %s",
  async (field, value) => {
    const { prepareComplaint, recordComplaintUnavailability } =
      await import("../../../sources/courtlistener/summary-acquisition.js");
    const s = await setup([
      { entry_number: 1, date_filed: "2025-01-01", recap_documents: [doc] },
    ]);
    await recordComplaintUnavailability(
      await prepareComplaint(s.args),
      s.args.state,
      unsummarized,
      "1",
    );
    const file = path.join(
      s.args.state,
      "complaint-reviews",
      `123-${createHash("sha256").update(pdf).digest("hex")}.json`,
    );
    const review = JSON.parse(await readFile(file, "utf8"));
    review.source[field] = value;
    await writeFile(file, JSON.stringify(review));
    await expect(acquireComplaintSummary(s.args)).rejects.toThrow("review");
    expect(s.analyze).not.toHaveBeenCalled();
  },
);
test("rejects an unsummarized receipt for a different prompt or PDF link", async () => {
  const { prepareComplaint, recordComplaintUnavailability } =
    await import("../../../sources/courtlistener/summary-acquisition.js");
  const s = await setup([
    { entry_number: 1, date_filed: "2025-01-01", recap_documents: [doc] },
  ]);
  const prepared = await prepareComplaint(s.args);
  await expect(
    recordComplaintUnavailability(
      prepared,
      s.args.state,
      { ...unsummarized, sourceUrl: "https://example.org/other.pdf" },
      "1",
    ),
  ).rejects.toThrow("review");
  await recordComplaintUnavailability(
    prepared,
    s.args.state,
    unsummarized,
    "1",
  );
  s.args.analyzer.promptVersion = "2";
  await expect(acquireComplaintSummary(s.args)).rejects.toThrow("review");
  expect(s.analyze).not.toHaveBeenCalled();
});
test("does not register an unsummarized review without a verified available PDF", async () => {
  const { prepareComplaint, recordComplaintUnavailability } =
    await import("../../../sources/courtlistener/summary-acquisition.js");
  const s = await setup([]);
  await expect(
    recordComplaintUnavailability(
      await prepareComplaint(s.args),
      s.args.state,
      unsummarized,
      "1",
    ),
  ).rejects.toThrow("verified complaint");
});
