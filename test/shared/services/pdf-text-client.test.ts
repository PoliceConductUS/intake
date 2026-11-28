import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ServiceUnavailableError } from "../../../src/shared/services/client-base.js";
import {
  createPdfTextClient,
  extractDocumentText,
  needsOcr,
  parsePageCount,
  pdfPageCountRequest,
  pdfPageTextRequest,
} from "../../../src/shared/services/pdf-text-client.js";
import { harness } from "./harness.js";

const PDFINFO = [
  "Creator:         TOSHIBA e-STUDIO4525AC",
  "Pages:           3",
  "Page size:       612 x 792 pts (letter)",
].join("\n");

describe("parsePageCount", () => {
  it("reads the page count out of pdfinfo output", () => {
    expect(parsePageCount(PDFINFO)).toBe(3);
  });

  it("fails loud when pdfinfo reports no page count", () => {
    expect(() => parsePageCount("Creator: x")).toThrow(/page count/);
  });
});

describe("needsOcr", () => {
  it("treats a page with no usable text layer as a scan", () => {
    expect(needsOcr("\f")).toBe(true);
    expect(needsOcr("PB 25-141\n\n\n")).toBe(true);
    expect(
      needsOcr("Tracy and the committee enter into this stipulation"),
    ).toBe(false);
  });
});

describe("extractDocumentText", () => {
  it("keeps a page's text layer and OCRs only the pages without one", async () => {
    const textLayers: Record<string, string> = {
      "1": "PB 25-141 STATE OF MINNESOTA BOARD OF PEACE OFFICER STANDARDS",
      "2": "\f",
      "3": "Findings of Fact 1. Tracy holds an active peace officer license",
    };
    const run = vi.fn(async (command: string, args: readonly string[]) => {
      if (command === "pdfinfo") return PDFINFO;
      const page = args[args.indexOf("-f") + 1];
      if (command === "pdftotext") return textLayers[page];
      if (command === "pdftoppm") return "";
      if (command === "tesseract") return `OCR of ${args[0]}`;
      throw new Error(`unexpected ${command}`);
    });

    const text = await extractDocumentText("/orders/order.pdf", run);

    expect(text.pages).toEqual([
      { page: 1, method: "text", text: textLayers["1"] },
      {
        page: 2,
        method: "ocr",
        text: expect.stringMatching(/^OCR of .*page-2\.png$/),
      },
      { page: 3, method: "text", text: textLayers["3"] },
    ]);
    const rendered = run.mock.calls.filter(
      ([command]) => command === "pdftoppm",
    );
    expect(rendered).toHaveLength(1);
    expect(rendered[0][1]).toEqual(
      expect.arrayContaining([
        "-r",
        "300",
        "-f",
        "2",
        "-l",
        "2",
        "/orders/order.pdf",
      ]),
    );
  });
});

describe("the folder a page's image is written to", () => {
  it("is named by its real path, which tesseract can read when the temporary folder is a link", async () => {
    const images: string[] = [];
    await extractDocumentText("/orders/order.pdf", async (command, args) => {
      if (command === "pdfinfo") return "Pages:           1";
      if (command === "pdftotext") return "\f";
      if (command === "tesseract") images.push(args[0]!);
      return "";
    });
    expect(images).toHaveLength(1);
    expect(path.dirname(path.dirname(images[0]!))).toBe(realpathSync(tmpdir()));
  });
});

describe("PdfTextClient", () => {
  const LAYERS: Record<string, string> = {
    "1": "The plaintiff alleges that the defendant officer detained him.",
    "2": "\f",
  };

  function tools(failing?: string) {
    return vi.fn(async (command: string, args: readonly string[]) => {
      if (args[0] === "-v" || args[0] === "--version") return "";
      if (command === failing)
        throw Object.assign(new Error("Syntax Error: not a PDF"), { code: 1 });
      if (command === "pdfinfo") return "Pages:           2";
      const page = args[args.indexOf("-f") + 1];
      if (command === "pdftotext") return LAYERS[page];
      if (command === "pdftoppm") return "";
      if (command === "tesseract")
        return `OCR of page ${/page-(\d+)\.png$/.exec(args[0])?.[1]}`;
      throw new Error(`unexpected ${command}`);
    });
  }

  async function stored(h: Awaited<ReturnType<typeof harness>>) {
    return h.deps.cache.writeBinaryFile({
      bytes: Buffer.from("%PDF-1.7 fixture"),
      contentType: "application/pdf",
      extension: "pdf",
      origin: {
        kind: "download",
        url: "https://example.org/complaint.pdf",
        retrievedAt: "2026-11-17T12:00:00.000Z",
        httpStatus: 200,
      },
    });
  }

  const work = (run: ReturnType<typeof tools>) =>
    run.mock.calls.filter(([, args]) => !/^(-v|--version)$/.test(args[0]));

  it("reads each page once and keeps the result by the file's SHA-256", async () => {
    const h = await harness();
    const file = await stored(h);
    const run = tools();
    const result = await createPdfTextClient({
      ...h.deps,
      runCommand: run,
    }).extractText(file);
    expect(result).toMatchObject({
      status: "succeeded",
      text: {
        pages: [
          { page: 1, method: "text", text: LAYERS["1"] },
          { page: 2, method: "ocr", text: "OCR of page 2" },
        ],
      },
    });
    const sha256 = file.envelope.spec.sha256;
    expect(await h.outcomes(pdfPageCountRequest(sha256))).toMatchObject([
      { status: "succeeded", response: { pages: 2 } },
    ]);
    expect(await h.outcomes(pdfPageTextRequest(sha256, 2))).toMatchObject([
      { status: "succeeded", response: { page: 2, method: "ocr" } },
    ]);

    const again = tools();
    const second = await createPdfTextClient({
      ...h.nextCommand(),
      runCommand: again,
    }).extractText(file);
    expect(second).toMatchObject({
      status: "succeeded",
      text: result.status === "succeeded" ? result.text : undefined,
    });
    expect(again).not.toHaveBeenCalled();
  });

  it("a file the tools cannot read is a failure of that file, kept in the cache", async () => {
    const h = await harness();
    const file = await stored(h);
    const result = await createPdfTextClient({
      ...h.deps,
      runCommand: tools("pdfinfo"),
    }).extractText(file);
    expect(result).toMatchObject({
      status: "failed",
      error: {
        kind: "item",
        message: "pdfinfo could not read the file: Syntax Error: not a PDF",
      },
    });
    const again = tools("pdfinfo");
    await createPdfTextClient({
      ...h.nextCommand(),
      runCommand: again,
    }).extractText(file);
    expect(work(again)).toEqual([]);
  });

  it.each([
    [
      ["tesseract"],
      "pdf-text is not available: tesseract cannot be run; `mise install` provides the PDF tools (tesseract: tesseract is not installed). No work that needs it was started.",
    ],
    [
      ["pdfinfo", "pdftotext", "pdftoppm", "tesseract"],
      "pdf-text is not available: pdfinfo, pdftotext, pdftoppm, and tesseract cannot be run; `mise install` provides the PDF tools (pdfinfo: pdfinfo is not installed; pdftotext: pdftotext is not installed; pdftoppm: pdftoppm is not installed; tesseract: tesseract is not installed). No work that needs it was started.",
    ],
  ])(
    "stops before any work and names every tool that cannot be run: %s",
    async (missing, message) => {
      const h = await harness();
      const file = await stored(h);
      const run = vi.fn(async (command: string) => {
        if (missing.includes(command))
          throw new Error(`${command} is not installed`);
        return "";
      });
      const stopped = createPdfTextClient({
        ...h.deps,
        runCommand: run,
      }).extractText(file);
      await expect(stopped).rejects.toThrow(ServiceUnavailableError);
      await expect(stopped).rejects.toThrow(message);
      expect(work(run as never)).toEqual([]);
      expect(await h.callResultCount()).toBe(0);
    },
  );
});
