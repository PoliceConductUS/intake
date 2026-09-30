alter table public.agency
add column status text
check (status is null or char_length(btrim(status)) > 0),
add column status_date date;
