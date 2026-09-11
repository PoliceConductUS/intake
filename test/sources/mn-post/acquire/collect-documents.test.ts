import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectDocuments,
  disciplinaryDocumentReferences,
  joinPages,
  type CollectDocumentsDeps,
  type DisciplinaryDocument,
  type DocumentText,
  type OrderAnalysis,
  type OrderAnalyzer,
} from "../../../../sources/mn-post/acquire/collect-documents.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

const ORDER_URL =
  "https://mnitservices.file.force.com/sfc/dist/version/download/?oid=00D40000000N34b&ids=068cr00000eArX7&d=%2Fa%2Fcr000006j3sj%2Ftoken&asPdf=false";
const GONE_URL =
  "https://mnitservices--c.documentforce.com/sfc/dist/version/download/?oid=00D40000000N34b&ids=06840000000dRlm&d=%2Fa%2F40000000CX5J%2Ftoken&asPdf=false";

// Production-shaped officer details: two officers cite the same order (a joint
// stipulation), a third cites a document the site no longer serves, a fourth
// has no discipline.
const details: Record<string, unknown> = {
  "officer-a.detail.json": {
    disciplinaryActions: [
      {
        contactId: "003A",
        caseNumber: "PB25-141",
        documentName: "SACO",
        documentURL: ORDER_URL,
        effectiveDate: "2026-01-22",
      },
    ],
  },
  "officer-b.detail.json": {
    disciplinaryActions: [
      {
        contactId: "003B",
        caseNumber: "PB25-142",
        documentName: "SACO",
        documentURL: ORDER_URL,
      },
    ],
  },
  "officer-c.detail.json": {
    disciplinaryActions: [
      {
        contactId: "003C",
        caseNumber: "Mark Kaspszak - Disciplinary Action",
        documentName: "SACO",
        documentURL: GONE_URL,
      },
    ],
  },
  "officer-d.detail.json": {
    disciplinaryActions: "No POST Disciplinary Actions found",
  },
};

const pdfBytes = Buffer.from("%PDF-1.7 fake order bytes");
const extracted: DocumentText = {
  pages: [
    { page: 1, method: "text", text: "PB 25-141\nSTIPULATION" },
    { page: 2, method: "ocr", text: "  " },
    { page: 3, method: "ocr", text: "Findings of Fact\n1. Tracy holds" },
  ],
};
const analysis: OrderAnalysis = {
  allegation: "engaging in sexual harassment",
  violation: "Minn. R. 6700.1600, subp. 1.A(4)",
  finding: "Tracy engaged in sexual harassment",
  chief_action: "LLPD placed Tracy on unpaid leave for 6 days",
  sanction:
    "license REVOKED, stayed for 6 years; SUSPENDED for 25 days; CENSURED",
};

async function makeFixture(): Promise<{
  sourceDir: string;
  statePath: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "mn-documents-"));
  tempDirs.push(dir);
  const sourceDir = path.join(dir, "source");
  await mkdir(path.join(sourceDir, "officers"), { recursive: true });
  for (const [name, detail] of Object.entries(details)) {
    await writeFile(
      path.join(sourceDir, "officers", name),
      JSON.stringify(detail),
    );
  }
  return { sourceDir, statePath: path.join(dir, "state") };
}

function fakeAnalyzer(): OrderAnalyzer & { analyze: ReturnType<typeof vi.fn> } {
  return {
    model: "test-model",
    promptVersion: 1,
    analyze: vi.fn(async () => analysis),
  };
}

function deps(
  fixture: { sourceDir: string; statePath: string },
  overrides: Partial<CollectDocumentsDeps> = {},
): CollectDocumentsDeps {
  return {
    ...fixture,
    fetchDocument: vi.fn(async (url: string) =>
      url === GONE_URL
        ? { kind: "unavailable" as const, reason: "the site returned 404" }
        : { kind: "pdf" as const, bytes: pdfBytes },
    ),
    extractText: vi.fn(async () => extracted),
    analyzer: fakeAnalyzer(),
    now: () => "2026-09-10T12:00:00.000Z",
    ...overrides,
  };
}

async function documentsOn(sourceDir: string): Promise<DisciplinaryDocument[]> {
  const dir = path.join(sourceDir, "documents");
  const names = (await readdir(dir)).filter((n) =>
    n.endsWith(".document.json"),
  );
  return Promise.all(
    names.map(
      async (n) =>
        JSON.parse(
          await readFile(path.join(dir, n), "utf8"),
        ) as DisciplinaryDocument,
    ),
  );
}

describe("disciplinaryDocumentReferences", () => {
  it("collects each distinct document URL with every action that cites it", async () => {
    const { sourceDir } = await makeFixture();
    const references = await disciplinaryDocumentReferences(
      path.join(sourceDir, "officers"),
    );
    expect(references).toEqual([
      {
        url: ORDER_URL,
        documentName: "SACO",
        actions: [
          { contactId: "003A", caseNumber: "PB25-141" },
          { contactId: "003B", caseNumber: "PB25-142" },
        ],
      },
      {
        url: GONE_URL,
        documentName: "SACO",
        actions: [
          {
            contactId: "003C",
            caseNumber: "Mark Kaspszak - Disciplinary Action",
          },
        ],
      },
    ]);
  });
});

describe("joinPages", () => {
  it("joins non-blank pages with a blank line between them", () => {
    expect(joinPages(extracted)).toBe(
      "PB 25-141\nSTIPULATION\n\nFindings of Fact\n1. Tracy holds",
    );
  });
});

describe("collectDocuments", () => {
  it("preserves the PDF and writes its text and analysis as one document record", async () => {
    const fixture = await makeFixture();
    const d = deps(fixture);
    const result = await collectDocuments(d);

    const pdfs = (
      await readdir(path.join(fixture.sourceDir, "documents"))
    ).filter((n) => n.endsWith(".pdf"));
    expect(pdfs).toEqual(["pb25-141-3c491d4f8f5b.pdf"]);
    expect(
      await readFile(path.join(fixture.sourceDir, "documents", pdfs[0])),
    ).toEqual(pdfBytes);

    const [document] = await documentsOn(fixture.sourceDir);
    expect(document).toEqual({
      url: ORDER_URL,
      documentName: "SACO",
      actions: [
        { contactId: "003A", caseNumber: "PB25-141" },
        { contactId: "003B", caseNumber: "PB25-142" },
      ],
      // shasum -a 256 of the fake PDF bytes
      sha256:
        "9321b051dac604b3e26aacf8ec3ef45bb039cc25c4768d0b7d021834d531a41d",
      bytes: pdfBytes.length,
      fetchedAt: "2026-09-10T12:00:00.000Z",
      pages: extracted.pages,
      text: "PB 25-141\nSTIPULATION\n\nFindings of Fact\n1. Tracy holds",
      analysis,
      analyzedWith: { model: "test-model", promptVersion: 1 },
    });
    expect(d.analyzer.analyze).toHaveBeenCalledWith(document.text);
    expect(result.skippedDocuments).toEqual([
      {
        url: GONE_URL,
        actions: [
          {
            contactId: "003C",
            caseNumber: "Mark Kaspszak - Disciplinary Action",
          },
        ],
        reason: "the site returned 404",
      },
    ]);
  });

  it("resumes: a second run fetches, extracts, and analyzes nothing already done", async () => {
    const fixture = await makeFixture();
    const d = deps(fixture);
    await collectDocuments(d);
    await collectDocuments(d);
    // the available order once; the unavailable one is re-tried each run
    expect(d.fetchDocument).toHaveBeenCalledTimes(3);
    expect(d.extractText).toHaveBeenCalledTimes(1);
    expect(d.analyzer.analyze).toHaveBeenCalledTimes(1);
  });

  it("reuses cached text and analysis for an unchanged document in a fresh acquire", async () => {
    const fixture = await makeFixture();
    await collectDocuments(deps(fixture));

    const fresh = await mkdtemp(path.join(tmpdir(), "mn-documents-fresh-"));
    tempDirs.push(fresh);
    const sourceDir = path.join(fresh, "source");
    await mkdir(path.join(sourceDir, "officers"), { recursive: true });
    await writeFile(
      path.join(sourceDir, "officers", "officer-a.detail.json"),
      JSON.stringify(details["officer-a.detail.json"]),
    );
    const d = deps({ sourceDir, statePath: fixture.statePath });
    await collectDocuments(d);

    expect(d.fetchDocument).toHaveBeenCalledTimes(1);
    expect(d.extractText).not.toHaveBeenCalled();
    expect(d.analyzer.analyze).not.toHaveBeenCalled();
    const [document] = await documentsOn(sourceDir);
    expect(document.analysis).toEqual(analysis);
  });

  it("banks every document's text before analyzing, so a keyless run leaves nothing to re-extract", async () => {
    const fixture = await makeFixture();
    const keyless = {
      ...fakeAnalyzer(),
      analyze: vi.fn(async () => {
        throw new Error(
          "mn-post: ANTHROPIC_API_KEY is required to analyze disciplinary orders.",
        );
      }),
    };
    const first = deps(fixture, { analyzer: keyless });
    await expect(collectDocuments(first)).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(first.extractText).toHaveBeenCalledTimes(1);

    const second = deps(fixture);
    await collectDocuments(second);
    expect(second.fetchDocument).toHaveBeenCalledTimes(1);
    expect(second.extractText).not.toHaveBeenCalled();
    expect(second.analyzer.analyze).toHaveBeenCalledTimes(1);
    expect(await documentsOn(fixture.sourceDir)).toHaveLength(1);
  });

  it("re-analyzes a cached document when the analyzer's prompt version changes", async () => {
    const fixture = await makeFixture();
    await collectDocuments(deps(fixture));
    await rm(path.join(fixture.sourceDir, "documents"), { recursive: true });

    const analyzer = { ...fakeAnalyzer(), promptVersion: 2 };
    const d = deps(fixture, { analyzer });
    await collectDocuments(d);

    expect(d.extractText).not.toHaveBeenCalled();
    expect(analyzer.analyze).toHaveBeenCalledTimes(1);
    const [document] = await documentsOn(fixture.sourceDir);
    expect(document.analyzedWith).toEqual({
      model: "test-model",
      promptVersion: 2,
    });
  });
});
