-- Give federal_agency_branch a surrogate id so it fits the id-keyed intake
-- import/mutation model like every other table. The existing unique(agency_id)
-- constraint still guarantees a given agency belongs to at most one federal
-- parent, so pair-uniqueness is preserved without the composite primary key.
alter table public.federal_agency_branch
  drop constraint federal_agency_branch_pkey;

alter table public.federal_agency_branch
  add column id text not null default public.generate_cuid();

alter table public.federal_agency_branch
  add constraint federal_agency_branch_pkey primary key (id);
