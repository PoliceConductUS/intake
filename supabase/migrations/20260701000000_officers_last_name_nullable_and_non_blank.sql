-- Officers may legitimately have no last name in the source: TCOLE uses the
-- literal string "NULL" as a missing-value sentinel for LNAME, and some of those
-- officers are real and currently active. Represent a missing last name as NULL
-- (not an empty string), and forbid blank strings so the database matches the
-- intake specs, where an empty string is never a valid value (`nonEmptyString`).

alter table public.officers
    alter column last_name drop not null;

alter table public.officers
    add constraint officers_first_name_not_blank
    check (char_length(btrim(first_name)) > 0);

alter table public.officers
    add constraint officers_last_name_not_blank
    check (last_name is null or char_length(btrim(last_name)) > 0);

alter table public.officers
    add constraint officers_slug_not_blank
    check (char_length(btrim(slug)) > 0);
