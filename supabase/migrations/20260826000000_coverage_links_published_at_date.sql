-- coverage_links.published_at holds a date-only value (a document's publication
-- date), and every other date field in the schema is a `date` column. It was the
-- lone `timestamptz`, so on re-import the current-row read returned a JS Date for
-- it and the update operation's `from`, validated against the string spec, was
-- rejected ("CoverageLinkUpdate is malformed at spec.operations.4.from"). Align it
-- with its siblings. Existing values are all midnight, so `::date` is lossless.
alter table public.coverage_links
  alter column published_at type date using published_at::date;
