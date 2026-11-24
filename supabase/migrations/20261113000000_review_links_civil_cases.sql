alter table public.review_links
add column civil_case_id text references public.civil_cases (id),
alter column url drop not null,
alter column title drop not null,
add constraint review_links_exactly_one_target check (
    (civil_case_id is null and url is not null and title is not null)
    or (civil_case_id is not null and url is null and title is null)
);

create unique index review_links_review_case_key
on public.review_links (review_id, civil_case_id)
where civil_case_id is not null;
