// Verbatim complaint intro for a CourtListener docket (ADR 0028 cases). The
// search endpoint only yields the PACER `cause` code, so a case's claims_summary
// is otherwise just a statute citation. This pulls the operative complaint's own
// "Nature of the Action"/introduction from RECAP and returns it verbatim — no
// paraphrase, no AI. Best-effort: RECAP only holds documents someone uploaded, so
// most helpers return undefined when the text is not available, and the caller
// falls back to the cause code.

const API = "https://www.courtlistener.com/api/rest/v4";

type RecapDocument = {
  description?: unknown;
  plain_text?: unknown;
  is_available?: unknown;
};

type DocketEntry = {
  entry_number?: unknown;
  description?: unknown;
  recap_documents?: unknown;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function entryNumber(entry: DocketEntry): number {
  const raw = entry.entry_number;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

// A document IS a complaint (the initiating pleading or an amended one), not a
// filing that merely names one (an answer, a motion to dismiss the complaint, a
// motion for leave to amend). Matched against the entry text + the document text.
const AMENDED = /\bamended\s+complaint\b/i;
const COMPLAINT = /\bcomplaint\b/i;
const NOT_A_COMPLAINT =
  /\b(answer|response|opposition|motion|memorandum|reply|order|notice|dismiss|leave to|to file)\b/i;

type ComplaintDoc = { entryNumber: number; doc: RecapDocument };

function complaintDocs(entries: DocketEntry[]): ComplaintDoc[] {
  const found: ComplaintDoc[] = [];
  for (const entry of entries) {
    const docs = Array.isArray(entry.recap_documents)
      ? (entry.recap_documents as RecapDocument[])
      : [];
    for (const doc of docs) {
      const label = `${str(entry.description)} ${str(doc.description)}`;
      if (COMPLAINT.test(label) && !NOT_A_COMPLAINT.test(label)) {
        found.push({ entryNumber: entryNumber(entry), doc });
      }
    }
  }
  return found;
}

// The operative complaint: the latest amended complaint if any, else the earliest
// complaint. Returns its extracted text, or undefined when none is available in RECAP.
export function selectOperativeComplaintText(
  entries: DocketEntry[],
): string | undefined {
  const complaints = complaintDocs(entries).filter(
    (candidate) =>
      candidate.doc.is_available !== false &&
      str(candidate.doc.plain_text).trim() !== "",
  );
  if (complaints.length === 0) return undefined;
  const amended = complaints.filter((candidate) =>
    AMENDED.test(str(candidate.doc.description)),
  );
  const chosen =
    amended.length > 0
      ? amended.reduce((a, b) => (b.entryNumber > a.entryNumber ? b : a))
      : complaints.reduce((a, b) => (b.entryNumber < a.entryNumber ? b : a));
  return str(chosen.doc.plain_text).trim();
}

const INTRO_HEADING =
  /\b(NATURE OF (?:THE )?(?:ACTION|CASE)|INTRODUCTION|PRELIMINARY STATEMENT)\b[:.\s]*/i;
const NEXT_HEADING =
  /\b(JURISDICTION(?: AND VENUE)?|VENUE|(?:THE )?PARTIES|FACTUAL (?:ALLEGATIONS|BACKGROUND)|STATEMENT OF (?:THE )?FACTS|GENERAL ALLEGATIONS|CAUSES? OF ACTION|CLAIMS? FOR RELIEF|COUNT (?:ONE|I|1)|EXHAUSTION)\b/i;

const MIN_INTRO_CHARS = 80;

/**
 * Extract the complaint's introduction verbatim from its OCR/extracted text: the
 * text under a "Nature of the Action"/"Introduction"/"Preliminary Statement"
 * heading, up to the next section heading. Returns undefined when no such section
 * is found or it is too short to be meaningful — the caller keeps the cause code.
 * Returned text is a verbatim slice of the filing (only whitespace is collapsed).
 */
export function extractComplaintIntro(
  plainText: string,
  maxChars = 1500,
): string | undefined {
  const text = plainText
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  const heading = INTRO_HEADING.exec(text);
  if (heading === null) return undefined;
  const bodyStart = heading.index + heading[0].length;
  const rest = text.slice(bodyStart);
  const next = NEXT_HEADING.exec(rest);
  const section = (next === null ? rest : rest.slice(0, next.index))
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (section.length < MIN_INTRO_CHARS) return undefined;
  if (section.length <= maxChars) return section;
  // Cap at a sentence/paragraph boundary within the limit rather than mid-word.
  const capped = section.slice(0, maxChars);
  const lastBreak = Math.max(
    capped.lastIndexOf(". "),
    capped.lastIndexOf("\n"),
  );
  return `${(lastBreak > MIN_INTRO_CHARS ? capped.slice(0, lastBreak + 1) : capped).trim()}…`;
}

// Fetch a docket's entries from RECAP and return the operative complaint's intro,
// or undefined. Best-effort: any error (no token access to entries, no uploaded
// document, an API change) yields undefined so the crawl continues on the cause code.
export async function fetchComplaintIntro(
  docketId: string,
  fetchJson: (url: string) => Promise<Record<string, unknown>>,
): Promise<string | undefined> {
  try {
    const body = await fetchJson(
      `${API}/docket-entries/?docket=${encodeURIComponent(docketId)}&page_size=100`,
    );
    const entries = Array.isArray(body.results)
      ? (body.results as DocketEntry[])
      : [];
    const complaintText = selectOperativeComplaintText(entries);
    return complaintText === undefined
      ? undefined
      : extractComplaintIntro(complaintText);
  } catch {
    return undefined;
  }
}
