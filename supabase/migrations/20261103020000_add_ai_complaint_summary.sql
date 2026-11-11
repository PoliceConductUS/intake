-- Independent source-backed AI content.
-- Legacy claims_summary is not reclassified.
alter table public.civil_cases
add column ai_complaint_summary jsonb;

alter table public.civil_cases
add constraint civil_cases_ai_complaint_summary_object
check (
    ai_complaint_summary is null
    or (
        jsonb_typeof(ai_complaint_summary) = 'object'
        and ai_complaint_summary ?& array[
            'summary', 'source', 'model', 'generatedAt', 'support',
            'publicationStatus', 'limitations', 'proceduralContext'
        ]
        and jsonb_typeof(ai_complaint_summary -> 'source') = 'object'
        and (ai_complaint_summary -> 'source') ?& array[
            'url', 'sourcePage', 'documentId', 'documentNumber', 'filingDate',
            'retrievedAt', 'sha1', 'sha256', 'sha1Verified', 'confidence'
        ]
        and ai_complaint_summary -> 'source' -> 'sha1Verified' = 'true'::jsonb
    )
);
