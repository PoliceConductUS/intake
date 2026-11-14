-- IDs are assigned before the write; the database never generates one (ADR 0008).
alter table public.agency alter column id drop default;
alter table public.agency_personnel alter column id drop default;
alter table public.agency_phone_numbers alter column id drop default;
alter table public.personnel alter column id drop default;
alter table public.review_links alter column id drop default;
alter table public.review_personnel alter column id drop default;
alter table public.reviews alter column id drop default;
