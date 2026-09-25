import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { DocumentPage, DocumentText } from "./collect-documents.js";

const execFileAsync = promisify(execFile);

export type CommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<string>;

// A page whose embedded text layer is shorter than this is a scan (the orders
// are mostly scanned signatures pages and photocopies) and is OCR'd instead.
const MIN_TEXT_LAYER_CHARS = 40;
const OCR_DPI = 300;
const OCR_CONCURRENCY = 4;

/**
 * The text of a PDF, page by page: the embedded text layer where the page has
 * one (pdftotext), tesseract OCR of a 300-dpi render where it does not. Tools:
 * poppler (pdfinfo, pdftotext, pdftoppm) and tesseract.
 */
export async function extractDocumentText(
  pdfPath: string,
  run: CommandRunner = runCommand,
): Promise<DocumentText> {
  const pageCount = parsePageCount(await run("pdfinfo", [pdfPath]));
  const workDir = await mkdtemp(path.join(tmpdir(), "mn-post-ocr-"));
  try {
    const pages: DocumentPage[] = [];
    for (let start = 1; start <= pageCount; start += OCR_CONCURRENCY) {
      const batch = Array.from(
        { length: Math.min(OCR_CONCURRENCY, pageCount - start + 1) },
        (_, offset) => start + offset,
      );
      pages.push(
        ...(await Promise.all(
          batch.map((page) => extractPage(pdfPath, page, workDir, run)),
        )),
      );
    }
    return { pages };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function extractPage(
  pdfPath: string,
  page: number,
  workDir: string,
  run: CommandRunner,
): Promise<DocumentPage> {
  const range = ["-f", String(page), "-l", String(page)];
  const textLayer = await run("pdftotext", ["-layout", ...range, pdfPath, "-"]);
  if (!needsOcr(textLayer)) {
    return { page, method: "text", text: textLayer };
  }
  const imageStem = path.join(workDir, `page-${page}`);
  await run("pdftoppm", [
    "-r",
    String(OCR_DPI),
    "-png",
    "-singlefile",
    ...range,
    pdfPath,
    imageStem,
  ]);
  const text = await run("tesseract", [`${imageStem}.png`, "stdout"]);
  return { page, method: "ocr", text };
}

export function needsOcr(textLayer: string): boolean {
  return textLayer.replace(/\s+/g, "").length < MIN_TEXT_LAYER_CHARS;
}

export function parsePageCount(pdfinfoOutput: string): number {
  const match = pdfinfoOutput.match(/^Pages:\s+(\d+)\s*$/m);
  if (match === null) {
    throw new Error("mn-post: pdfinfo did not report a page count");
  }
  return Number(match[1]);
}

async function runCommand(
  command: string,
  args: readonly string[],
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, [...args], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `mn-post: ${command} is required to read disciplinary orders (brew install poppler tesseract).`,
      );
    }
    throw error;
  }
}
