## Why

MN POST publishes each disciplinary action as a stipulation and consent order
(or board order) PDF, but the license-search site — and so our `discipline`
rows — carry only the case number, document type, and dates. What the officer
was alleged to have done, what the Board found, what the chief did about it,
and what sanction was ordered are all inside the document. For an
accountability database those facts are the point of the record; without them
a discipline row is a date and a link.

## What Changes

**mn-post acquire reads the order documents**

- From: acquire stores each action's `documentURL` and nothing else about it.
- To: acquire downloads every order PDF through the same browser session,
  preserves it unchanged under `documents/`, extracts its text (embedded text
  layer, OCR for scanned pages), has Claude report what it says as structured
  fields, and writes one `documents/<stem>.document.json` per order. Text and
  analysis are cached in source state by document hash; a document the site no
  longer serves is reported in `skipped.yaml`, never fabricated.
- Reason: the order document is the only source of the discipline's substance.
- Impact: acquire needs poppler + tesseract on the workstation and
  `ANTHROPIC_API_KEY` when an order is new; a resumed acquire with everything
  cached needs neither the key nor the license-search session.

**Discipline carries what the order says**

- From: `discipline` has `action`, `effective_date`, `expiration_date`,
  `case_number`.
- To: plus nullable `allegation`, `violation`, `finding`, `chief_action`,
  `sanction`, filled by the mn-post transform from the acquired document
  record, null when the document is unavailable or silent.
- Impact: additive migration `20260910000000_discipline_order_details.sql`;
  regenerated `DisciplineSpec` / `DisciplineCreate` / `DisciplineUpdate`;
  existing rows update on the next `data generate` / `data up`.

## Capabilities

### New Capabilities

- `mn-post-discipline-orders`: acquiring, reading, and analyzing MN POST
  disciplinary order documents, and carrying their substance on `Discipline`.

### Modified Capabilities

- none (the `artifacts-database-import` requirements are unchanged; the new
  columns flow through the generated entity specs).

## Impact

- `sources/mn-post/acquire.ts` (+ `acquire/collect-documents.ts`,
  `document-fetch.ts`, `document-text.ts`, `order-analysis.ts`),
  `sources/mn-post/transform.ts`, `supabase/migrations/20260910000000_*`,
  generated specs/mutations, `Brewfile`, `.env.example`.
- New dependency `@anthropic-ai/sdk` (structured output via `messages.parse`).
