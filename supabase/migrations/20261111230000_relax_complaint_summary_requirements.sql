alter table public.civil_cases
drop constraint civil_cases_ai_complaint_summary_object;

alter table public.civil_cases
add constraint civil_cases_ai_complaint_summary_object
check (
    ai_complaint_summary is null
    or coalesce(
        jsonb_typeof(ai_complaint_summary) = 'object'
        and jsonb_typeof(ai_complaint_summary -> 'summary') = 'string'
        and btrim(ai_complaint_summary ->> 'summary') <> ''
        and jsonb_typeof(ai_complaint_summary -> 'source') = 'object'
        and jsonb_typeof(ai_complaint_summary -> 'source' -> 'sourcePage')
        = 'string'
        and ai_complaint_summary -> 'source' ->> 'sourcePage'
        ~ '^https?://[^[:space:]]+$',
        false
    )
);
