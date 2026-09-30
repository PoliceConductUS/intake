alter table public.agency
add column parent_federal_agency_id text references public.federal_agency (id);

create index agency_parent_federal_agency_idx
on public.agency (parent_federal_agency_id);
