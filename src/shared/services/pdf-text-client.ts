import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { StoredBinaryFile } from "../io/BinaryFile.js";
import type { CallOutcome, CallRequest } from "../io/CallResult.js";
import {
  createServiceClientBase,
  type CallAttempt,
  type ClientDeps,
  type ItemFailure,
  type ServiceSkips,
} from "./client-base.js";

const execFileAsync = promisify(execFile);

export type CommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<string>;

export type DocumentPage = {
  page: number;
  method: "text" | "ocr";
  text: string;
};
export type DocumentText = { pages: DocumentPage[] };

const MIN_TEXT_LAYER_CHARS = 40;
const OCR_DPI = 300;
const OCR_CONCURRENCY = 4;
const TOOLS = ["pdfinfo", "pdftotext", "pdftoppm", "tesseract"] as const;

/**
 * The text of a PDF, page by page: the embedded text layer where the page has
 * one (pdftotext), tesseract OCR of a 300-dpi render where it does not. Tools:
 * poppler (pdfinfo, pdftotext, pdftoppm) and tesseract, which `mise install`
 * provides (mise.toml).
 */
export async function extractDocumentText(
  pdfPath: string,
  run: CommandRunner = runCommand,
): Promise<DocumentText> {
  const pageCount = parsePageCount(await run("pdfinfo", [pdfPath]));
  const workDir = await imageDirectory();
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

async function imageDirectory(): Promise<string> {
  return mkdtemp(path.join(await realpath(tmpdir()), "pdf-text-"));
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
    throw new Error("pdfinfo did not report a page count");
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
      throw new Error(`${command} is not installed`);
    }
    throw error;
  }
}

export type PdfTextResult =
  | { status: "succeeded"; text: DocumentText; outcome: CallOutcome }
  | { status: "failed"; error: ItemFailure; outcome: CallOutcome }
  | { status: "skipped"; service: string; retryAfter: string };

export type PdfTextClient = {
  extractText(file: StoredBinaryFile): Promise<PdfTextResult>;
  skips(): ServiceSkips[];
};

export function pdfPageCountRequest(sha256: string): CallRequest {
  return {
    service: "pdf-text",
    operation: "page-count",
    inputs: [{ name: "pdf", sha256 }],
  };
}

export function pdfPageTextRequest(sha256: string, page: number): CallRequest {
  return {
    service: "pdf-text",
    operation: "page-text",
    parameters: {
      page,
      ocrDpi: OCR_DPI,
      minTextLayerChars: MIN_TEXT_LAYER_CHARS,
    },
    inputs: [{ name: "pdf", sha256 }],
  };
}

function exitedWithStatus(error: unknown): error is Error & { code: number } {
  return (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "number"
  );
}

export function createPdfTextClient(
  deps: ClientDeps & { runCommand?: CommandRunner },
): PdfTextClient {
  const run = deps.runCommand ?? runCommand;

  const base = createServiceClientBase({
    ...deps,
    service: "pdf-text",
    check: async () => {
      const failures: { tool: string; message: string }[] = [];
      for (const tool of TOOLS) {
        try {
          await run(tool, [tool === "tesseract" ? "--version" : "-v"]);
        } catch (error) {
          failures.push({
            tool,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (failures.length === 0) return { ok: true };
      const names = new Intl.ListFormat("en", { type: "conjunction" }).format(
        failures.map(({ tool }) => tool),
      );
      return {
        ok: false,
        reason: `${names} cannot be run; \`mise install\` provides the PDF tools (${failures.map(({ tool, message }) => `${tool}: ${message}`).join("; ")})`,
      };
    },
  });

  async function attempt(
    command: string,
    work: () => Promise<unknown>,
  ): Promise<CallAttempt> {
    try {
      return { kind: "response", response: await work() };
    } catch (error) {
      if (!exitedWithStatus(error)) throw error;
      return {
        kind: "item-failure",
        message: `${command} could not read the file: ${error.message}`,
      };
    }
  }

  return {
    async extractText(file) {
      const sha256 = file.envelope.spec.sha256;
      const counted = await base.cachedCall(pdfPageCountRequest(sha256), () =>
        attempt("pdfinfo", async () => ({
          pages: parsePageCount(await run("pdfinfo", [file.filePath])),
        })),
      );
      if (counted.status !== "succeeded") return counted;
      const { pages: pageCount } = (await base.jsonResponse(
        counted.outcome,
      )) as { pages: number };
      const pages: DocumentPage[] = [];
      let outcome = counted.outcome;
      for (let page = 1; page <= pageCount; page += 1) {
        const read = await base.cachedCall(
          pdfPageTextRequest(sha256, page),
          () =>
            attempt("pdftotext", async () => {
              const workDir = await imageDirectory();
              try {
                return await extractPage(file.filePath, page, workDir, run);
              } finally {
                await rm(workDir, { recursive: true, force: true });
              }
            }),
        );
        if (read.status !== "succeeded") return read;
        pages.push((await base.jsonResponse(read.outcome)) as DocumentPage);
        outcome = read.outcome;
      }
      return { status: "succeeded", text: { pages }, outcome };
    },
    skips: () => {
      const skips = base.skips();
      return skips === undefined ? [] : [skips];
    },
  };
}
