import crypto from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { CollectLogger, OfficerDetail } from "./collect.js";

export type DocumentAction = { contactId: string; caseNumber: string };

export type FetchedDocument =
  | { kind: "pdf"; bytes: Buffer }
  | { kind: "unavailable"; reason: string };

export type DocumentPage = {
  page: number;
  method: "text" | "ocr";
  text: string;
};
export type DocumentText = { pages: DocumentPage[] };

export type OrderAnalysis = {
  allegation: string | null;
  violation: string | null;
  finding: string | null;
  chief_action: string | null;
  sanction: string | null;
};
export type OrderAnalyzer = {
  model: string;
  promptVersion: number;
  analyze(text: string): Promise<OrderAnalysis>;
};

/** `documents/<stem>.document.json` — the record the transform reads per order. */
export type DisciplinaryDocument = {
  url: string;
  documentName: string | null;
  actions: DocumentAction[];
  sha256: string;
  bytes: number;
  fetchedAt: string;
  pages: DocumentPage[];
  text: string;
  analysis: OrderAnalysis;
  analyzedWith: { model: string; promptVersion: number };
};

export type SkippedDocument = {
  url: string;
  actions: DocumentAction[];
  reason: string;
};

type DocumentCache = {
  text?: DocumentText;
  analysis?: { model: string; promptVersion: number; output: OrderAnalysis };
};

export type CollectDocumentsDeps = {
  sourceDir: string;
  statePath: string;
  fetchDocument: (url: string) => Promise<FetchedDocument>;
  extractText: (pdfPath: string) => Promise<DocumentText>;
  analyzer: OrderAnalyzer;
  now: () => string;
  logger?: CollectLogger;
};

const silentLogger: CollectLogger = { info() {} };

/**
 * Download each disciplinary order the officer details point at, extract its
 * text, and have it analyzed — one `documents/<stem>.pdf` (the evidence,
 * preserved unchanged) plus `documents/<stem>.document.json` per distinct
 * document URL. A document already on disk is reused, so an interrupted run
 * resumes; text and analysis are cached in state by the PDF's sha256, so a
 * re-acquire never re-OCRs or re-analyzes an unchanged document. A document the
 * site no longer serves is skipped and reported, never written as if it were
 * data.
 */
export async function collectDocuments({
  sourceDir,
  statePath,
  fetchDocument,
  extractText,
  analyzer,
  now,
  logger = silentLogger,
}: CollectDocumentsDeps): Promise<{ skippedDocuments: SkippedDocument[] }> {
  const documentsDir = path.join(sourceDir, "documents");
  const cacheDir = path.join(statePath, "documents");
  await mkdir(documentsDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });

  const references = await disciplinaryDocumentReferences(
    path.join(sourceDir, "officers"),
  );
  logger.info(`mn-post: ${references.length} disciplinary documents`);

  // Two passes: every document is fetched and its text extracted before any is
  // analyzed, so a run that stops at analysis (no API key, a refusal) has
  // already banked the slow, keyless work for the next one.
  const skippedDocuments: SkippedDocument[] = [];
  const extracted: Array<{
    reference: DocumentReference;
    sha256: string;
    bytes: number;
    fetchedAt: string;
    cachePath: string;
  }> = [];
  for (const [index, reference] of references.entries()) {
    const position = `[${index + 1}/${references.length}]`;
    const stem = documentStem(reference);
    const pdfPath = path.join(documentsDir, `${stem}.pdf`);
    if (await fileExists(path.join(documentsDir, `${stem}.document.json`))) {
      continue;
    }

    let bytes = await readBytesIfExists(pdfPath);
    let fetchedAt: string;
    if (bytes !== null) {
      fetchedAt = (await stat(pdfPath)).mtime.toISOString();
    } else {
      const fetched = await fetchDocument(reference.url);
      if (fetched.kind === "unavailable") {
        skippedDocuments.push({
          url: reference.url,
          actions: reference.actions,
          reason: fetched.reason,
        });
        logger.info(
          `mn-post: ${position} skipping ${describeActions(reference.actions)} — ${fetched.reason}`,
        );
        continue;
      }
      bytes = fetched.bytes;
      fetchedAt = now();
      await writeFile(pdfPath, bytes);
    }

    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const cachePath = path.join(cacheDir, `${sha256}.json`);
    const cache = (await readJsonIfExists<DocumentCache>(cachePath)) ?? {};
    if (cache.text === undefined) {
      logger.info(
        `mn-post: ${position} extracting text of ${describeActions(reference.actions)}`,
      );
      cache.text = await extractText(pdfPath);
      await writeJson(cachePath, cache);
    }
    extracted.push({
      reference,
      sha256,
      bytes: bytes.length,
      fetchedAt,
      cachePath,
    });
  }

  for (const [index, entry] of extracted.entries()) {
    const position = `[${index + 1}/${extracted.length}]`;
    const cache = (await readJsonIfExists<DocumentCache>(entry.cachePath))!;
    const text = joinPages(cache.text!);
    if (
      cache.analysis === undefined ||
      cache.analysis.model !== analyzer.model ||
      cache.analysis.promptVersion !== analyzer.promptVersion
    ) {
      logger.info(
        `mn-post: ${position} analyzing ${describeActions(entry.reference.actions)}`,
      );
      cache.analysis = {
        model: analyzer.model,
        promptVersion: analyzer.promptVersion,
        output: await analyzer.analyze(text),
      };
      await writeJson(entry.cachePath, cache);
    }

    const document: DisciplinaryDocument = {
      url: entry.reference.url,
      documentName: entry.reference.documentName,
      actions: entry.reference.actions,
      sha256: entry.sha256,
      bytes: entry.bytes,
      fetchedAt: entry.fetchedAt,
      pages: cache.text!.pages,
      text,
      analysis: cache.analysis.output,
      analyzedWith: {
        model: cache.analysis.model,
        promptVersion: cache.analysis.promptVersion,
      },
    };
    await writeJson(
      path.join(documentsDir, `${documentStem(entry.reference)}.document.json`),
      document,
    );
  }

  return { skippedDocuments };
}

export type DocumentReference = {
  url: string;
  documentName: string | null;
  actions: DocumentAction[];
};

/**
 * Every distinct document URL across the officer details, with the disciplinary
 * actions (officer + case) that cite it — one officer's order is one document,
 * but the same order can be cited by more than one action.
 */
export async function disciplinaryDocumentReferences(
  officersDir: string,
): Promise<DocumentReference[]> {
  const byUrl = new Map<string, DocumentReference>();
  const files = (await readdir(officersDir).catch(() => []))
    .filter((name) => name.endsWith(".detail.json"))
    .sort();
  for (const name of files) {
    const detail = JSON.parse(
      await readFile(path.join(officersDir, name), "utf8"),
    ) as OfficerDetail;
    if (!Array.isArray(detail.disciplinaryActions)) continue;
    for (const raw of detail.disciplinaryActions) {
      const action = (raw ?? {}) as Record<string, unknown>;
      const url = nonEmpty(action.documentURL);
      const contactId = nonEmpty(action.contactId);
      const caseNumber = nonEmpty(action.caseNumber);
      if (url === null || contactId === null || caseNumber === null) continue;
      const reference = byUrl.get(url) ?? {
        url,
        documentName: nonEmpty(action.documentName),
        actions: [],
      };
      reference.actions.push({ contactId, caseNumber });
      byUrl.set(url, reference);
    }
  }
  return [...byUrl.values()];
}

/** `<case number slug>-<url hash>`: readable, and distinct per document URL (one case number can cite two documents). */
export function documentStem(reference: DocumentReference): string {
  const slug =
    reference.actions[0].caseNumber
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "order";
  const hash = crypto
    .createHash("sha256")
    .update(reference.url)
    .digest("hex")
    .slice(0, 12);
  return `${slug}-${hash}`;
}

export function joinPages(text: DocumentText): string {
  return text.pages
    .map((page) => page.text.trim())
    .filter((page) => page !== "")
    .join("\n\n");
}

function describeActions(actions: DocumentAction[]): string {
  return actions.map((action) => action.caseNumber).join(", ");
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readBytesIfExists(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  const bytes = await readBytesIfExists(filePath);
  return bytes === null ? null : (JSON.parse(bytes.toString("utf8")) as T);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
