import courts from "./reference/court-citations.json" with { type: "json" };

export type CaseCitationInput = {
  title: string;
  cause_number: string;
  court?: string | null;
  filed_date: string;
  full_citation?: string | null;
  citation_source_url?: string | null;
};

function required(value: string | null | undefined, field: string): string {
  if (!value?.trim()) throw new Error(`Case citation requires ${field}.`);
  return value.trim();
}

/** Full source citation, or an explicitly labelled docket reference, not an opinion. */
export function caseCitation(input: CaseCitationInput): string {
  if (input.full_citation?.trim()) {
    const source = required(input.citation_source_url, "citation source URL");
    if (!/^https?:\/\//.test(source))
      throw new Error("Invalid citation source URL.");
    return input.full_citation.trim();
  }
  const title = required(input.title, "title");
  const docket = required(input.cause_number, "docket number");
  const court = required(input.court, "court");
  const date = required(input.filed_date, "filing date");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Invalid filing date: ${date}.`);
  }
  const matches = new Set(
    courts
      .filter(
        (c) =>
          c.id === court &&
          c.dates.some(
            (d) => (!d.start || d.start <= date) && (!d.end || date <= d.end),
          ),
      )
      .map((c) => c.citation)
      .filter(Boolean),
  );
  if (matches.size !== 1)
    throw new Error(
      `Missing or ambiguous court citation for ${court} on ${date}.`,
    );
  const months = [
    "Jan.",
    "Feb.",
    "Mar.",
    "Apr.",
    "May",
    "June",
    "July",
    "Aug.",
    "Sept.",
    "Oct.",
    "Nov.",
    "Dec.",
  ];
  const displayDate = `${months[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}`;
  return `${title}, No. ${docket} (${[...matches][0]} filed ${displayDate})`;
}

export function caseCitationSlug(input: CaseCitationInput): string {
  const slug = caseCitation(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("Citation produced an empty slug.");
  return slug;
}
