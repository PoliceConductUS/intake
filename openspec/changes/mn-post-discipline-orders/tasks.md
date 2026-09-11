## 1. Schema

- [x] 1.1 Migration `20260910000000_discipline_order_details.sql`: nullable
      non-blank `allegation`, `violation`, `finding`, `chief_action`,
      `sanction` on `public.discipline`; regenerate entity specs and mutations.

## 2. Acquire

- [x] 2.1 `acquire/collect-documents.ts`: per distinct document URL, preserve
      the PDF, extract + analyze (state cache by sha256), write the document
      record; unavailable documents on the skip report.
- [x] 2.2 `acquire/document-fetch.ts`: direct download via the browser
      context's request API; public content pages resolved to the direct
      download URL from the rendered version id; 404 / dead delivery →
      unavailable.
- [x] 2.3 `acquire/document-text.ts`: pdftotext per page, tesseract OCR for
      pages without a text layer.
- [x] 2.4 `acquire/order-analysis.ts`: Claude structured output
      (`messages.parse` + zod) in the document's words; lazy, keyless when
      cached.
- [x] 2.5 `acquire.ts`: lazy license-search client; documents after rosters;
      skip report gains `skippedDocuments`.

## 3. Transform

- [x] 3.1 `transform.ts` indexes `*.document.json` by URL and fills the five
      order fields on each Discipline (null when absent).

## 4. Tests + validation

- [x] 4.1 Unit tests: collect-documents (resume, cache, prompt-version
      re-analysis, unavailable), document-fetch URL derivation, document-text
      OCR decision, transform join.
- [x] 4.2 `Brewfile` (poppler, tesseract) and `.env.example`
      (`ANTHROPIC_API_KEY`).
- [ ] 4.3 Live: `intake data acquire mn-post` (resumed from the latest
      acquisition) → `data transform` → `data generate` → `data up`.
