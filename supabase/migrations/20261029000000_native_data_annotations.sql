-- Preserve prior evidence for regeneration. This archive is not published.
create table public.legacy_data_annotation_evidence (
    subject_kind text not null,
    subject_id text not null,
    evidence jsonb not null,
    primary key (subject_kind, subject_id)
);

create table public.data_annotation (
    id text primary key,
    subject_kind text not null check (char_length(btrim(subject_kind)) > 0),
    subject_id text not null check (char_length(btrim(subject_id)) > 0),
    producer_namespace text not null check (
        char_length(btrim(producer_namespace)) > 0
    ),
    producer_record_id text not null check (
        char_length(btrim(producer_record_id)) > 0
    ),
    source_namespace text not null check (
        char_length(btrim(source_namespace)) > 0
    ),
    source_record_id text not null check (
        char_length(btrim(source_record_id)) > 0
    ),
    type text not null check (type in ('warning', 'error', 'correction')),
    field text not null check (char_length(btrim(field)) > 0),
    value jsonb not null,
    replacement_value jsonb,
    message text not null check (char_length(btrim(message)) > 0),
    evidence jsonb,
    status text not null check (status in ('active', 'resolved')),
    unique (producer_namespace, producer_record_id)
);
create index data_annotation_subject_idx on public.data_annotation (
    subject_kind, subject_id, status
);

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'LocationPath' as subject_kind,
    location_path_id,
    data_annotations
from public.location_path
where data_annotations <> '[]'::jsonb;
alter table public.location_path drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'LocationPathGeometry' as subject_kind,
    location_path_id,
    data_annotations
from public.location_path_geometry
where data_annotations <> '[]'::jsonb;
alter table public.location_path_geometry drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'LocationPathAlias' as subject_kind,
    alias_path,
    data_annotations
from public.location_path_alias
where data_annotations <> '[]'::jsonb;
alter table public.location_path_alias drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'Agency' as subject_kind,
    id,
    data_annotations
from public.agency
where data_annotations <> '[]'::jsonb;
alter table public.agency drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'Personnel' as subject_kind,
    id,
    data_annotations
from public.personnel
where data_annotations <> '[]'::jsonb;
alter table public.personnel drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'AgencyPersonnel' as subject_kind,
    id,
    data_annotations
from public.agency_personnel
where data_annotations <> '[]'::jsonb;
alter table public.agency_personnel drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'LicensingAuthority' as subject_kind,
    id,
    data_annotations
from public.licensing_authority
where data_annotations <> '[]'::jsonb;
alter table public.licensing_authority drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'AuthorityLicense' as subject_kind,
    id,
    data_annotations
from public.authority_license
where data_annotations <> '[]'::jsonb;
alter table public.authority_license drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'LicenseAction' as subject_kind,
    id,
    data_annotations
from public.license_action
where data_annotations <> '[]'::jsonb;
alter table public.license_action drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'PersonnelEducation' as subject_kind,
    id,
    data_annotations
from public.personnel_education
where data_annotations <> '[]'::jsonb;
alter table public.personnel_education drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'PersonnelPhoto' as subject_kind,
    id,
    data_annotations
from public.personnel_photo
where data_annotations <> '[]'::jsonb;
alter table public.personnel_photo drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'DisciplineAgencyPersonnel' as subject_kind,
    id,
    data_annotations
from public.discipline_agency_personnel
where data_annotations <> '[]'::jsonb;
alter table public.discipline_agency_personnel drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'CoverageLink' as subject_kind,
    id,
    data_annotations
from public.coverage_links
where data_annotations <> '[]'::jsonb;
alter table public.coverage_links drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'CoverageLinkAgencyPersonnel' as subject_kind,
    id,
    data_annotations
from public.coverage_link_agency_personnel
where data_annotations <> '[]'::jsonb;
alter table public.coverage_link_agency_personnel drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'AgencyPhoneNumber' as subject_kind,
    id,
    data_annotations
from public.agency_phone_numbers
where data_annotations <> '[]'::jsonb;
alter table public.agency_phone_numbers drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'FederalAgency' as subject_kind,
    id,
    data_annotations
from public.federal_agency
where data_annotations <> '[]'::jsonb;
alter table public.federal_agency drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'CivilCase' as subject_kind,
    id,
    data_annotations
from public.civil_cases
where data_annotations <> '[]'::jsonb;
alter table public.civil_cases drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'CivilCasePersonnel' as subject_kind,
    id,
    data_annotations
from public.civil_case_personnel
where data_annotations <> '[]'::jsonb;
alter table public.civil_case_personnel drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'CivilCaseLink' as subject_kind,
    id,
    data_annotations
from public.civil_case_links
where data_annotations <> '[]'::jsonb;
alter table public.civil_case_links drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'Review' as subject_kind,
    id,
    data_annotations
from public.reviews
where data_annotations <> '[]'::jsonb;
alter table public.reviews drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'ReviewPersonnel' as subject_kind,
    id,
    data_annotations
from public.review_personnel
where data_annotations <> '[]'::jsonb;
alter table public.review_personnel drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'ReviewLink' as subject_kind,
    id,
    data_annotations
from public.review_links
where data_annotations <> '[]'::jsonb;
alter table public.review_links drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'ArrestProfile' as subject_kind,
    id,
    data_annotations
from public.arrest_profile
where data_annotations <> '[]'::jsonb;
alter table public.arrest_profile drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'AgencyArrestProfile' as subject_kind,
    id,
    data_annotations
from public.agency_arrest_profile
where data_annotations <> '[]'::jsonb;
alter table public.agency_arrest_profile drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'License' as subject_kind,
    id,
    data_annotations
from public.license
where data_annotations <> '[]'::jsonb;
alter table public.license drop column data_annotations;

insert into public.legacy_data_annotation_evidence (
    subject_kind, subject_id, evidence
)
select
    'Discipline' as subject_kind,
    id,
    data_annotations
from public.discipline
where data_annotations <> '[]'::jsonb;
alter table public.discipline drop column data_annotations;
