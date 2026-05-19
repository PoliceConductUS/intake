-- Refactor civil_case_officers to use agency_officer_id instead of officer_id
-- This mirrors the review_officers pattern where agency_officer_id links to both officer and agency

-- Add category column to civil_cases (like agency and reviews have)
ALTER TABLE public.civil_cases
  ADD COLUMN IF NOT EXISTS category text;

-- Drop civil_case_agencies (agency is now inferred from agency_officer_id)
DROP TABLE IF EXISTS public.civil_case_agencies;

-- Drop old civil_case_officers table
DROP TABLE IF EXISTS public.civil_case_officers;

-- Create new civil_case_officers table with agency_officer_id
CREATE TABLE public.civil_case_officers (
    id text NOT NULL,
    civil_case_id text NOT NULL REFERENCES public.civil_cases(id) ON DELETE CASCADE,
    agency_officer_id text NOT NULL REFERENCES public.agency_officers(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (id)
);

-- Unique constraint on civil_case_id + agency_officer_id pair
CREATE UNIQUE INDEX civil_case_officers_case_agency_officer_unique
    ON public.civil_case_officers(civil_case_id, agency_officer_id);

-- Index for lookups by agency_officer_id
CREATE INDEX civil_case_officers_agency_officer_id_idx
    ON public.civil_case_officers(agency_officer_id);

-- Index for lookups by civil_case_id
CREATE INDEX civil_case_officers_civil_case_id_idx
    ON public.civil_case_officers(civil_case_id);
