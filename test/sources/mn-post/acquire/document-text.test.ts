import { describe, expect, it, vi } from "vitest";
import {
  extractDocumentText,
  needsOcr,
  parsePageCount,
} from "../../../../sources/mn-post/acquire/document-text.js";

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
