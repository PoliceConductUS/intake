-- Null records are unassessed.
-- Never infer a missing complaint from a null summary.
alter table public.civil_cases
add column complaint_summary_unavailability jsonb;

alter table public.civil_cases
add constraint civil_cases_complaint_summary_unavailability_object
check (
    complaint_summary_unavailability is null
    or (
        ai_complaint_summary is null
        and jsonb_typeof(complaint_summary_unavailability) = 'object'
        and complaint_summary_unavailability ?& array[
            'reason', 'sourceUrl', 'checkedAt', 'detail'
        ]
        and complaint_summary_unavailability ->> 'reason' in (
            'missing_copy', 'pending', 'retrieval_failed',
            'authentication_failed', 'generation_failed'
        )
    )
);
