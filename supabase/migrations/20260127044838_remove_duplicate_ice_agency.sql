-- Consolidate duplicate ICE agencies
-- Keep the one with reports, rename it to include "(ICE)", delete the empty duplicate

-- First, rename the agency that has linked officers/reports to include "(ICE)" and use abbreviation slug
UPDATE public.agency
SET name = 'U.S. Immigration and Customs Enforcement (ICE)',
    slug = 'ice',
    updated_at = NOW()
WHERE name = 'U.S. Immigration and Customs Enforcement'
AND id IN (SELECT DISTINCT agency_id FROM public.agency_officers WHERE agency_id IS NOT NULL);

-- Delete agency_stats for the duplicate (the one with no linked officers)
DELETE FROM public.agency_stats
WHERE id IN (
  SELECT id FROM public.agency
  WHERE name = 'U.S. Immigration and Customs Enforcement (ICE)'
  AND id NOT IN (SELECT DISTINCT agency_id FROM public.agency_officers WHERE agency_id IS NOT NULL)
);

-- Delete the duplicate agency (the one with no linked officers)
DELETE FROM public.agency
WHERE name = 'U.S. Immigration and Customs Enforcement (ICE)'
AND id NOT IN (SELECT DISTINCT agency_id FROM public.agency_officers WHERE agency_id IS NOT NULL);

-- Update other federal agency slugs to use common abbreviations
UPDATE public.agency SET slug = 'fbi', updated_at = NOW()
WHERE name = 'Federal Bureau of Investigation (FBI)' AND slug != 'fbi';

UPDATE public.agency SET slug = 'dea', updated_at = NOW()
WHERE name = 'Drug Enforcement Administration (DEA)' AND slug != 'dea';

UPDATE public.agency SET slug = 'atf', updated_at = NOW()
WHERE name = 'Bureau of Alcohol, Tobacco, Firearms and Explosives (ATF)' AND slug != 'atf';

UPDATE public.agency SET slug = 'usms', updated_at = NOW()
WHERE name = 'U.S. Marshals Service' AND slug != 'usms';

UPDATE public.agency SET slug = 'cbp', updated_at = NOW()
WHERE name = 'U.S. Customs and Border Protection (CBP)' AND slug != 'cbp';

UPDATE public.agency SET slug = 'usss', updated_at = NOW()
WHERE name = 'U.S. Secret Service (USSS)' AND slug != 'usss';

UPDATE public.agency SET slug = 'tsa', updated_at = NOW()
WHERE name = 'Transportation Security Administration (TSA)' AND slug != 'tsa';

UPDATE public.agency SET slug = 'uscg', updated_at = NOW()
WHERE name = 'U.S. Coast Guard (USCG)' AND slug != 'uscg';
