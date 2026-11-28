import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  selectComplaint,
  summarizeComplaint,
} from "../../../src/cli/import/artifacts/facades/complaint-summary-resolvers.js";
import {
  harness,
  START,
  type FakeAnswer,
  type Harness,
} from "../../shared/services/harness.js";
import {
  COMPLAINT_PAGE,
  complaintDocument,
  complaintEntry,
  DOCKET_URL,
  FILE_URL,
  json,
  modelAnswer,
  NAMESPACE,
  outside,
  PDF,
  PDF_SHA1,
  PDF_SHA256,
  type Outside,
} from "./complaint-summary-fixture.js";

const DAY_MS = 86_400_000;
const entries = (...results: unknown[]): FakeAnswer =>
  json({ results, next: null });

const docketEvidence = {
  what: "docket",
  source_namespace: NAMESPACE,
  url: DOCKET_URL,
};
const documentEvidence = {
  what: "complaint document",
  source_namespace: NAMESPACE,
  url: COMPLAINT_PAGE,
};
const fileEvidence = {
  what: "downloaded file",
  source_namespace: NAMESPACE,
  url: FILE_URL,
  retrieved_at: START,
  sha256: PDF_SHA256,
};

async function summarize(
  answers: Outside = {},
  options: { h?: Harness; next?: boolean; prompt?: string } = {},
) {
  const h = options.h ?? (await harness());
  const world = outside(options.next ? h.nextCommand() : h.deps, answers);
  const result = await summarizeComplaint({
    docketUrl: DOCKET_URL,
    docketId: "12",
    sourceNamespace: NAMESPACE,
    clients: world.clients,
    prompt: options.prompt,
  });
  if (result.status !== "done") throw new Error("The complaint was skipped.");
  return { h, world, result };
}

describe("a complaint that can be summarized", () => {
  test("carries the document's URL, page, filing date, hashes and the model that answered, and says the SHA-1 matched", async () => {
    const { result, world } = await summarize();

    expect(result.findings).toEqual([]);
    expect(result.complaint_summary_unavailability).toBeNull();
    expect(result.ai_complaint_summary).toMatchObject({
      summary: "The plaintiff alleges an unlawful arrest.\n\nHe seeks damages.",
      source: {
        url: FILE_URL,
        sourcePage: COMPLAINT_PAGE,
        documentId: 123,
        documentNumber: "1",
        filingDate: "2025-01-01",
        retrievedAt: START,
        sha1: PDF_SHA1,
        sha256: PDF_SHA256,
        sha1Verified: true,
      },
      model: "claude-opus-5-5-20261001",
      generatedAt: "2026-11-17",
      support: [
        { paragraph: 1, pages: "1, 2" },
        { paragraph: 2, pages: "2" },
      ],
    });
    expect(world.work()).toMatchObject({ entries: 1, files: 1, model: 1 });
  });

  test("a second run with nothing changed makes no request and gives the same summary", async () => {
    const first = await summarize();
    first.h.advance(DAY_MS);
    const second = await summarize({}, { h: first.h, next: true });

    expect(second.world.work()).toEqual({
      entries: 0,
      files: 0,
      model: 0,
      pdfTools: 0,
    });
    expect(second.result).toEqual(first.result);
  });

  test("a changed prompt asks the model again and reuses the entries, the PDF and its text", async () => {
    const first = await summarize();
    const second = await summarize(
      {
        model: modelAnswer({
          paragraphs: [{ text: "A shorter summary.", pages: [1] }],
        }),
      },
      { h: first.h, next: true, prompt: "Summarize in one sentence." },
    );

    expect(second.world.work()).toEqual({
      entries: 0,
      files: 0,
      model: 1,
      pdfTools: 0,
    });
    expect(second.result.ai_complaint_summary?.summary).toBe(
      "A shorter summary.",
    );
  });
});

describe("a complaint problem is a state and a finding, one per code", () => {
  function expectProblem(
    result: Awaited<ReturnType<typeof summarize>>["result"],
    expected: {
      code: string;
      type: "warning" | "error";
      reason: string;
      value: unknown;
      message: string;
      url: string;
      evidence: unknown[];
    },
  ) {
    expect(result.ai_complaint_summary).toBeNull();
    expect(result.complaint_summary_unavailability).toEqual({
      reason: expected.reason,
      detail: expected.message,
      sourceUrl: expected.url,
      checkedAt: START,
    });
    expect(result.findings).toEqual([
      {
        code: expected.code,
        type: expected.type,
        field: "ai_complaint_summary",
        value: expected.value,
        message: expected.message,
        evidence: expected.evidence,
        source_namespace: NAMESPACE,
        source_record_id: "12",
      },
    ]);
  }

  test("complaint-entries: the docket's entries cannot be fetched", async () => {
    const { result, world } = await summarize({ entries: json({}, 404) });
    expectProblem(result, {
      code: "complaint-entries",
      type: "error",
      reason: "retrieval_failed",
      value: null,
      message: `We could not summarize the complaint in this case because we could not get the list of documents filed in it. The case on CourtListener: ${DOCKET_URL}`,
      url: DOCKET_URL,
      evidence: [docketEvidence],
    });
    expect(world.work()).toMatchObject({ files: 0, model: 0 });
  });

  test("complaint-entries: the entries do not have the expected shape", async () => {
    const { result } = await summarize({
      entries: entries({ entry_number: 1, description: "COMPLAINT" }),
    });
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "complaint-entries",
    ]);
    expect(result.complaint_summary_unavailability?.reason).toBe(
      "retrieval_failed",
    );
  });

  test("complaint-not-found: no complaint is identified in the entries", async () => {
    const { result } = await summarize({
      entries: entries({
        entry_number: 4,
        date_filed: "2025-01-09",
        description: "ANSWER to Complaint",
        recap_documents: [{ ...complaintDocument, description: "Answer" }],
      }),
    });
    expectProblem(result, {
      code: "complaint-not-found",
      type: "warning",
      reason: "pending",
      value: null,
      message: `We could not summarize the complaint in this case because we could not find it among the documents filed. The case on CourtListener: ${DOCKET_URL}`,
      url: DOCKET_URL,
      evidence: [docketEvidence],
    });
  });

  test("complaint-no-copy: the identified complaint has no available copy", async () => {
    const { result, world } = await summarize({
      entries: entries(complaintEntry({ is_available: false })),
    });
    expectProblem(result, {
      code: "complaint-no-copy",
      type: "warning",
      reason: "missing_copy",
      value: "1",
      message: `We could not summarize the complaint in this case because a free copy of it is not available. The case on CourtListener: ${DOCKET_URL} You can help: if you buy the complaint from PACER with the free RECAP browser extension installed, it becomes free for everyone on CourtListener. How to set that up: https://free.law/recap/`,
      url: DOCKET_URL,
      evidence: [docketEvidence, documentEvidence],
    });
    expect(world.work()).toMatchObject({ files: 0, model: 0 });
  });

  test("complaint-no-copy: the copy's download address is not on storage.courtlistener.com", async () => {
    const { result, world } = await summarize({
      entries: entries(
        complaintEntry({ filepath_local: "https://files.example/c.pdf" }),
      ),
    });
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "complaint-no-copy",
    ]);
    expect(world.work()).toMatchObject({ files: 0, model: 0 });
  });

  test("complaint-no-check: CourtListener records no SHA-1 for the file", async () => {
    const { result, world } = await summarize({
      entries: entries(complaintEntry({ sha1: "" })),
    });
    expectProblem(result, {
      code: "complaint-no-check",
      type: "error",
      reason: "retrieval_failed",
      value: "1",
      message: `We could not summarize the complaint in this case because we could not confirm that the copy we found is the right file. The complaint: ${COMPLAINT_PAGE}`,
      url: COMPLAINT_PAGE,
      evidence: [docketEvidence, documentEvidence],
    });
    expect(world.work()).toMatchObject({ files: 0, model: 0 });
  });

  test("complaint-download: the PDF cannot be downloaded", async () => {
    const { result, world } = await summarize({ file: { status: 404 } });
    expectProblem(result, {
      code: "complaint-download",
      type: "warning",
      reason: "retrieval_failed",
      value: 404,
      message: `We could not summarize the complaint in this case because we could not download it. The complaint: ${COMPLAINT_PAGE}`,
      url: COMPLAINT_PAGE,
      evidence: [docketEvidence, documentEvidence],
    });
    expect(world.work()).toMatchObject({ model: 0, pdfTools: 0 });
  });

  test("complaint-not-pdf: the served file is not a PDF", async () => {
    const page = Buffer.from("<html>Not found</html>");
    const { result, world, h } = await summarize({
      file: {
        status: 200,
        headers: { "content-type": "text/html" },
        body: page,
      },
    });
    expect(result.ai_complaint_summary).toBeNull();
    expect(result.complaint_summary_unavailability).toMatchObject({
      reason: "retrieval_failed",
      sourceUrl: COMPLAINT_PAGE,
      detail: `We could not summarize the complaint in this case because the file could not be opened. The complaint: ${COMPLAINT_PAGE}`,
    });
    expect(result.findings).toMatchObject([
      { code: "complaint-not-pdf", type: "error", value: "1" },
    ]);
    expect(result.findings[0].evidence).toHaveLength(3);
    expect(result.findings[0].evidence?.[2]).toMatchObject({
      what: "downloaded file",
      url: FILE_URL,
    });
    expect(world.work()).toMatchObject({ model: 0, pdfTools: 0 });
    expect(await h.binaryFileNames()).toContainEqual(
      expect.stringMatching(/\.html$/),
    );
  });

  test("complaint-no-text: no text can be extracted from the PDF", async () => {
    const { result, world } = await summarize({ pages: ["\f", " \n\f"] });
    expectProblem(result, {
      code: "complaint-no-text",
      type: "warning",
      reason: "available_unsummarized",
      value: "1",
      message: `We could not summarize the complaint in this case because its text could not be read. The complaint: ${COMPLAINT_PAGE}`,
      url: COMPLAINT_PAGE,
      evidence: [docketEvidence, documentEvidence, fileEvidence],
    });
    expect(world.work()).toMatchObject({ model: 0 });
  });

  test("complaint-no-summary: the model refuses", async () => {
    const { result } = await summarize({
      model: modelAnswer(undefined, { stop_reason: "refusal", content: [] }),
    });
    expectProblem(result, {
      code: "complaint-no-summary",
      type: "warning",
      reason: "available_unsummarized",
      value: "1",
      message: `We tried to summarize the complaint in this case and could not. The complaint: ${COMPLAINT_PAGE}`,
      url: COMPLAINT_PAGE,
      evidence: [docketEvidence, documentEvidence, fileEvidence],
    });
  });

  test("complaint-no-summary: the summary cites a page the complaint does not have", async () => {
    const { result } = await summarize({
      model: modelAnswer({
        paragraphs: [{ text: "An invented allegation.", pages: [3] }],
      }),
    });
    expect(result.ai_complaint_summary).toBeNull();
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "complaint-no-summary",
    ]);
  });
});

describe("a file that does not match its recorded SHA-1", () => {
  const recorded = "0".repeat(40);
  const mismatched = entries(complaintEntry({ sha1: recorded }));
  const message = `The summary of the complaint in this case was made from a copy that is not the file CourtListener has on record. Do not trust the summary, or anything else on this page that was worked out from that copy. The complaint: ${COMPLAINT_PAGE}`;

  test("is stored under its SHA-256, read, summarized with sha1Verified false, and reported once as an error", async () => {
    const { result, world, h } = await summarize({ entries: mismatched });

    expect(await h.binaryFileNames()).toContain(`${PDF_SHA256}.pdf`);
    expect(world.work()).toMatchObject({ files: 1, model: 1 });
    expect(world.commands).toContain("pdftotext");
    expect(result.complaint_summary_unavailability).toBeNull();
    expect(result.ai_complaint_summary).toMatchObject({
      summary: "The plaintiff alleges an unlawful arrest.\n\nHe seeks damages.",
      source: { sha1: recorded, sha256: PDF_SHA256, sha1Verified: false },
    });
    expect(result.findings).toEqual([
      {
        code: "complaint-mismatch",
        type: "error",
        field: "ai_complaint_summary",
        value: {
          recordedSha1: recorded,
          servedSha1: PDF_SHA1,
          servedSha256: PDF_SHA256,
          bytes: PDF.length,
        },
        message,
        evidence: [docketEvidence, documentEvidence, fileEvidence],
        source_namespace: NAMESPACE,
        source_record_id: "12",
      },
    ]);
    expect(message).not.toContain("SHA-1");

    const again = await summarize({ entries: mismatched }, { h, next: true });
    expect(again.world.work()).toEqual({
      entries: 0,
      files: 0,
      model: 0,
      pdfTools: 0,
    });
    expect(again.result).toEqual(result);
  });

  test("and cannot be read has no summary, the available_unsummarized state and both findings", async () => {
    const { result } = await summarize({ entries: mismatched, pages: ["\f"] });

    expect(result.ai_complaint_summary).toBeNull();
    expect(result.complaint_summary_unavailability?.reason).toBe(
      "available_unsummarized",
    );
    expect(result.findings.map(({ code, type }) => ({ code, type }))).toEqual([
      { code: "complaint-mismatch", type: "error" },
      { code: "complaint-no-text", type: "warning" },
    ]);
  });
});

describe("the address a message gives", () => {
  test.each([
    ["has no page of its own", ""],
    ["has a page on another host", "https://files.example/docket/12/1/"],
  ])("is the docket's when the complaint %s", async (_case, absolute_url) => {
    const { result } = await summarize({
      entries: entries(complaintEntry({ absolute_url })),
      file: { status: 404 },
    });

    expect(result.findings[0].message).toBe(
      `We could not summarize the complaint in this case because we could not download it. The complaint: ${DOCKET_URL}`,
    );
    expect(result.complaint_summary_unavailability?.sourceUrl).toBe(DOCKET_URL);
    expect(JSON.stringify(result)).not.toContain("files.example");
  });
});

describe("when a problem is tried again", () => {
  test("a download that answered 404 is not requested again the next day", async () => {
    const first = await summarize({ file: { status: 404 } });
    first.h.advance(DAY_MS);
    const second = await summarize({}, { h: first.h, next: true });

    expect(second.world.work()).toMatchObject({ entries: 0, files: 0 });
    expect(second.result).toEqual(first.result);
  });

  test("the entries are fetched again after 120 days, and a complaint they now identify is summarized", async () => {
    const first = await summarize({ entries: entries() });
    expect(first.result.findings.map((finding) => finding.code)).toEqual([
      "complaint-not-found",
    ]);

    first.h.advance(119 * DAY_MS);
    const within = await summarize({}, { h: first.h, next: true });
    expect(within.world.work()).toMatchObject({ entries: 0 });
    expect(within.result).toEqual(first.result);

    first.h.advance(2 * DAY_MS);
    const after = await summarize({}, { h: first.h, next: true });
    expect(after.world.work()).toMatchObject({
      entries: 1,
      files: 1,
      model: 1,
    });
    expect(after.result.findings).toEqual([]);
    expect(after.result.ai_complaint_summary?.summary).toContain(
      "unlawful arrest",
    );
  });
});

describe("an outage during the run", () => {
  test.each<[string, Outside]>([
    ["CourtListener", { entries: { status: 503 } }],
    ["the file host", { file: { status: 503 } }],
    ["the model service", { model: json({ type: "error" }, 529) }],
  ])("of %s skips the case and reports nothing", async (_service, answers) => {
    const h = await harness();
    const world = outside(h.deps, answers);
    expect(
      await summarizeComplaint({
        docketUrl: DOCKET_URL,
        docketId: "12",
        sourceNamespace: NAMESPACE,
        clients: world.clients,
      }),
    ).toEqual({ status: "skipped" });
    expect(world.clients.skips()).toHaveLength(1);
  });
});

describe("selectComplaint", () => {
  const doc = complaintDocument;
  const selectedId = (list: Record<string, unknown>[]) =>
    selectComplaint(list)?.doc.id;

  test("selects a later amended complaint that has no copy instead of an older available one", () => {
    const selected = selectComplaint([
      { entry_number: 1, date_filed: "2025-01-01", recap_documents: [doc] },
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
    ]);
    expect(selected).toMatchObject({
      doc: { id: 124, is_available: false },
      date: "2025-02-01",
    });
  });

  test("recognizes an amended complaint from the entry despite a generic document label", () => {
    expect(
      selectedId([
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
            },
          ],
        },
      ]),
    ).toBe(124);
  });

  test("selects an explicitly labelled complaint attachment, not the generic main document or a parties list", () => {
    expect(
      selectedId([
        {
          entry_number: 7,
          date_filed: "2025-02-01",
          description: "AMENDED COMPLAINT filed by Plaintiff",
          recap_documents: [
            { ...doc, id: 200, description: "Amended Document (NOT Motion)" },
            {
              ...doc,
              id: 201,
              attachment_number: 2,
              description:
                "Additional Page(s) Plaintiff's First Amended Complaint - Parties to Suit",
            },
            {
              ...doc,
              id: 202,
              attachment_number: 1,
              description:
                "Additional Page(s) Plaintiff's First Amended Complaint",
            },
          ],
        },
      ]),
    ).toBe(202);
  });

  test("does not give a complaint entry's label to an exhibit attachment", () => {
    expect(
      selectComplaint([
        {
          entry_number: 7,
          date_filed: "2025-02-01",
          description: "COMPLAINT",
          recap_documents: [
            { ...doc, attachment_number: 1, description: "Exhibit A" },
          ],
        },
      ]),
    ).toBeUndefined();
  });

  test("does not select a proposed complaint attached to a motion for leave", () => {
    expect(
      selectedId([
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
            },
          ],
        },
      ]),
    ).toBe(123);
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
      },
    ],
  };
  const numbered = {
    ...complaintEvent,
    entry_number: 1,
    description: "COMPLAINT",
    recap_documents: [doc],
  };

  test("leaves out an empty duplicate of the numbered complaint's own event", () => {
    expect(selectedId([duplicateStub, numbered])).toBe(123);
  });

  test.each([
    { time_filed: "16:08:05" },
    { docket: 13 },
    { date_filed: "2025-01-02" },
    { recap_sequence_number: "2025-01-01.002" },
    { time_filed: "" },
  ])(
    "does not accept a stub with a distinct or incomplete event identity %j",
    (change) => {
      expect(() =>
        selectComplaint([{ ...duplicateStub, ...change }, numbered]),
      ).toThrow(z.ZodError);
    },
  );
});
