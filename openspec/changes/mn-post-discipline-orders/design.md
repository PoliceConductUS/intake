## Context

Every mn-post disciplinary action links a PDF on Salesforce file storage in one
of two shapes: a direct version download (`/sfc/dist/version/download/…`) that
serves the PDF as-is, and a public content-delivery page (`/sfc/p/…`) that
renders the file in the browser. Roughly a third of the older direct links are
dead (404). The PDFs are mostly scans (no text layer), so OCR is required. The
documents follow a stable structure — stipulation (basis and sanctions),
findings of fact, conclusions of law, other stipulated provisions, consent
order — but the "chief's action" (what the employer did) is stated inside the
findings in free prose, so a deterministic parser cannot pull it out.

## Goals / Non-Goals

**Goals:**

- Preserve every order document as evidence, once, and re-use it.
- Carry what the order says onto the discipline record in the document's own
  words: allegation, violation, finding, chief's action, sanction.
- Keep all network and non-determinism (download, OCR, Claude) in acquire;
  the transform stays a deterministic join.

**Non-Goals:**

- Storing the full order text in the database (it stays in the acquired
  artifact and state cache).
- Parsing the site's own complaint records (the site exposes none beyond the
  action row).

## Decisions

- **Download through the existing browser context.** Direct links are fetched
  with the context's request API; a public content page is opened, the rendered
  file version id read out of it, and the same direct download URL derived.
  A 404, or a delivery page that no longer serves a file, is `unavailable` and
  goes on the skip report — the run does not fail, and nothing is written.
- **Text layer first, OCR per page.** `pdftotext` per page; a page whose text
  layer is under 40 non-space characters is rendered at 300 dpi (`pdftoppm`)
  and OCR'd (`tesseract`). Both methods are recorded per page.
- **Claude structured output, in the document's words.** One
  `messages.parse` call per document with a zod schema of five nullable string
  fields and instructions to quote or closely condense, never add or soften;
  every field null when the document does not state it. Model
  `claude-opus-5`; a refusal or unparsable result fails loud.
- **Cache by content hash in state.** `state/mn-post/documents/<sha256>.json`
  holds the extracted text and the analysis stamped with model and prompt
  version; an unchanged document is never re-OCR'd, and re-analyzed only when
  the prompt version or model changes.
- **Lazy license-search client.** The Aura client opens on first use, so a
  resumed acquire whose rosters/details are on disk does not open the
  CAPTCHA-gated search app just to add documents.
- **Transform joins by URL.** `documents/*.document.json` are indexed by the
  action's `documentURL`; the discipline spec takes the five fields from the
  analysis, null when there is no record.

## Risks / Trade-offs

- The analysis is model output. It is constrained to the document's language,
  every field is nullable, and the full text plus the PDF are preserved beside
  it, so a reader can check any field against the source.
- OCR quality on signature pages is poor; the instructions tell the model to
  ignore scanning artifacts, and those pages carry no substantive fields.
