-- ADR 0029 phase 1 (non-breaking): add the /report/new narrative + metadata
-- columns to reviews. All nullable, no renames or drops — the current display
-- keeps working; description folds into what_happened later, with the display.
alter table public.reviews
  add column if not exists what_happened text,
  add column if not exists how_felt text,
  add column if not exists what_else text,
  add column if not exists incident_time time,
  add column if not exists submitter_relationship text,
  add column if not exists interaction_type text,
  add column if not exists setting text,
  add column if not exists bodycam_requested text,
  add column if not exists complaint_filed text,
  add column if not exists purpose text,
  add column if not exists case_number text;
