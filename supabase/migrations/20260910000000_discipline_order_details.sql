-- What the disciplinary order itself says. MN POST publishes each action as a
-- stipulation and consent order (or board order) PDF; the site lists only the
-- case number, document type, and dates. These columns hold the facts read out
-- of that document: what the officer was alleged to have done, the rules or
-- statutes cited, what the Board found, what the employing agency (the chief)
-- did about it, and the sanction the Board ordered. All nullable — an order
-- whose document is unavailable, or that does not state a field, leaves it null.
alter table public.discipline
  add column allegation text
    check (allegation is null or char_length(btrim(allegation)) > 0),
  add column violation text
    check (violation is null or char_length(btrim(violation)) > 0),
  add column finding text
    check (finding is null or char_length(btrim(finding)) > 0),
  add column chief_action text
    check (chief_action is null or char_length(btrim(chief_action)) > 0),
  add column sanction text
    check (sanction is null or char_length(btrim(sanction)) > 0);
