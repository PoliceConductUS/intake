-- "Officer" is a misnomer: these records are any personnel a licensing authority
-- licenses, not only sworn officers. Rename the intake-owned tables and foreign
-- key columns from officer → personnel. Foreign keys pointing at the renamed
-- tables (including the website's review_officers and the *_stats tables) follow
-- the rename automatically; their own names are left to the website to change.
alter table public.officers rename to personnel;
alter table public.agency_officers rename to agency_personnel;
alter table public.civil_case_officers rename to civil_case_personnel;
alter table public.discipline_agency_officers rename to discipline_agency_personnel;
alter table public.coverage_link_agency_officers rename to coverage_link_agency_personnel;

alter table public.agency_personnel rename column officer_id to personnel_id;
alter table public.license rename column officer_id to personnel_id;
alter table public.civil_case_personnel rename column agency_officer_id to agency_personnel_id;
alter table public.discipline_agency_personnel rename column agency_officer_id to agency_personnel_id;
alter table public.coverage_link_agency_personnel rename column agency_officer_id to agency_personnel_id;
