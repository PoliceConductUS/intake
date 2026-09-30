-- Finish the officer → personnel rename on the website-owned review tables, so
-- the term is consistent across the whole schema. The website repo updates its
-- queries against these renamed tables/columns; this migration is the signal.
alter table public.review_officers rename to review_personnel;
alter table public.review_officers_ratings rename to review_personnel_ratings;

alter table public.review_personnel rename column agency_officer_id to agency_personnel_id;
alter table public.review_personnel_ratings rename column review_officer_id to review_personnel_id;
