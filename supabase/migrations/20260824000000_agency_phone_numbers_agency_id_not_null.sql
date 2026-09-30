-- Every phone number belongs to an agency (there is nowhere else for it to
-- resolve to), so agency_phone_numbers.agency_id must be NOT NULL. The column
-- was nullable by oversight; no row has a null agency_id.
alter table public.agency_phone_numbers
  alter column agency_id set not null;
