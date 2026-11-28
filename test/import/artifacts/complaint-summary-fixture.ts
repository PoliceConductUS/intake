import { createHash } from "node:crypto";
import {
  createServiceClients,
  type ServiceClients,
} from "../../../src/shared/services/index.js";
import type { ClientDeps } from "../../../src/shared/services/client-base.js";
import { fakeFetch, type FakeAnswer } from "../../shared/services/harness.js";

export const NAMESPACE = "com/courtlistener/www/api";
export const DOCKET_URL = "https://www.courtlistener.com/docket/12/doe-v-city/";
export const COMPLAINT_PAGE =
  "https://www.courtlistener.com/docket/12/1/doe-v-city/";
export const FILE_URL = "https://storage.courtlistener.com/recap/example.pdf";
export const PDF = Buffer.from("%PDF-1.7 synthetic complaint");
export const PDF_SHA1 = createHash("sha1").update(PDF).digest("hex");
export const PDF_SHA256 = createHash("sha256").update(PDF).digest("hex");
export const PAGES = [
  "The plaintiff alleges that the defendant officer arrested him unlawfully.\f",
  "The plaintiff seeks damages from the officer and from the city he serves.\f",
];
export const PARAGRAPHS = [
  { text: "The plaintiff alleges an unlawful arrest.", pages: [1, 2] },
  { text: "He seeks damages.", pages: [2] },
];

export const complaintDocument = {
  id: 123,
  document_number: "1",
  attachment_number: null,
  description: "COMPLAINT",
  is_available: true,
  filepath_local: "recap/example.pdf",
  sha1: PDF_SHA1,
  absolute_url: "/docket/12/1/doe-v-city/",
};

export function complaintEntry(document: Record<string, unknown> = {}) {
  return {
    entry_number: 1,
    date_filed: "2025-01-01",
    description: "COMPLAINT",
    recap_documents: [{ ...complaintDocument, ...document }],
  };
}

export const json = (body: unknown, status = 200): FakeAnswer => ({
  status,
  headers: { "content-type": "application/json", "request-id": "req_1" },
  body: JSON.stringify(body),
});

export function modelAnswer(
  answer: unknown = { paragraphs: PARAGRAPHS },
  overrides: Record<string, unknown> = {},
): FakeAnswer {
  return json({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5-20261001",
    content: [{ type: "text", text: JSON.stringify(answer) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 30 },
    ...overrides,
  });
}

export type Outside = {
  entries?: FakeAnswer;
  file?: FakeAnswer;
  pages?: string[];
  ocr?: string;
  model?: FakeAnswer;
};

/** The service clients over one fake of every outside service. */
export function outside(deps: ClientDeps, answers: Outside = {}) {
  const pages = answers.pages ?? PAGES;
  const web = fakeFetch((url) => {
    const { host, pathname } = new URL(url);
    if (host === "www.courtlistener.com")
      return pathname === "/api/rest/v4/courts/"
        ? json({ results: [] })
        : (answers.entries ??
            json({ results: [complaintEntry()], next: null }));
    if (host === "storage.courtlistener.com")
      return pathname === "/"
        ? { status: 200 }
        : (answers.file ?? {
            status: 200,
            headers: { "content-type": "application/pdf" },
            body: PDF,
          });
    if (host === "api.anthropic.com")
      return pathname === "/v1/models"
        ? json({ data: [], has_more: false, first_id: null, last_id: null })
        : (answers.model ?? modelAnswer());
    throw new Error(`A request left for an unexpected host: ${url}`);
  });
  const commands: string[] = [];
  const clients: ServiceClients = createServiceClients({
    ...deps,
    maxRetries: 0,
    fetch: web.fetch,
    env: { COURTLISTENER_API_TOKEN: "fixture", ANTHROPIC_API_KEY: "fixture" },
    runCommand: async (command, args) => {
      if (args[0] === "-v" || args[0] === "--version") return "";
      commands.push(command);
      if (command === "pdfinfo") return `Pages:           ${pages.length}`;
      if (command === "pdftotext")
        return pages[Number(args[args.indexOf("-f") + 1]) - 1];
      if (command === "pdftoppm") return "";
      if (command === "tesseract") return answers.ocr ?? "";
      throw new Error(`unexpected ${command}`);
    },
  });
  const requests = (host: string, pathname?: string) =>
    web.calls
      .map((call) => new URL(call.url))
      .filter(
        (url) =>
          url.host === host &&
          (pathname === undefined || url.pathname === pathname),
      );
  return {
    clients,
    commands,
    /** Requests that did work, leaving out each service's check. */
    work: () => ({
      entries: requests("www.courtlistener.com", "/api/rest/v4/docket-entries/")
        .length,
      files: requests("storage.courtlistener.com").filter(
        (url) => url.pathname !== "/",
      ).length,
      model: requests("api.anthropic.com", "/v1/messages").length,
      pdfTools: commands.length,
    }),
  };
}
