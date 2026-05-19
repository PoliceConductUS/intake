-- Migration: Change review_officers.officer_id to agency_officer_id
-- This links reviews directly to the officer-at-agency context

-- Step 1: Add new column
ALTER TABLE public.review_officers
  ADD COLUMN IF NOT EXISTS agency_officer_id text;

-- Step 2: Populate new column from existing data
-- Maps officer_id + review.incident_date to the appropriate agency_officers record
UPDATE review_officers ro
SET agency_officer_id = (
  SELECT ao.id
  FROM agency_officers ao
  JOIN reviews r ON r.id = ro.review_id
  WHERE ao.officer_id = ro.officer_id
    AND r.incident_date >= ao.start_date
    AND (ao.end_date IS NULL OR r.incident_date <= ao.end_date)
  ORDER BY ao.start_date DESC
  LIMIT 1
);

-- Step 3: Verify no orphaned records (fail if any exist)
DO $$
DECLARE
  orphan_count integer;
  orphan_details text;
BEGIN
  SELECT COUNT(*), string_agg(ro.id || ' (officer: ' || ro.officer_id || ', review: ' || ro.review_id || ')', ', ')
  INTO orphan_count, orphan_details
  FROM review_officers ro
  WHERE ro.agency_officer_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % review_officers records have no matching agency_officer. Records: %', orphan_count, orphan_details;
  END IF;
END $$;

-- Step 4: Add NOT NULL constraint
ALTER TABLE public.review_officers
  ALTER COLUMN agency_officer_id SET NOT NULL;

-- Step 5: Add foreign key constraint
ALTER TABLE public.review_officers
  ADD CONSTRAINT review_officers_agency_officer_id_fkey
  FOREIGN KEY (agency_officer_id) REFERENCES agency_officers(id);

-- Step 6: Create index on new column
CREATE INDEX IF NOT EXISTS review_officers_agency_officer_id_idx
  ON public.review_officers(agency_officer_id);

-- Step 7: Drop old column and index
DROP INDEX IF EXISTS review_officers_officer_id_idx;
ALTER TABLE public.review_officers
  DROP CONSTRAINT IF EXISTS review_officers_officer_id_fkey;
ALTER TABLE public.review_officers
  DROP COLUMN IF EXISTS officer_id;

-- Step 8: Disable stats-related triggers (stats are pre-calculated in seed)
-- These can be re-enabled later after updating the functions
DO $$
BEGIN
  ALTER TABLE public.agency_officers DISABLE TRIGGER agency_officer_change;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.review_officers_ratings DISABLE TRIGGER review_rating_change;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.agency_stats DISABLE TRIGGER update_agency_stats_overall_stats;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.officers_stats DISABLE TRIGGER update_officers_stats_overall_stats;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
