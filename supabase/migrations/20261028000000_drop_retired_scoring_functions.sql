-- Complete retirement of the scoring model removed in August 2026.
-- These functions reference dropped scoring tables or serve only that model.
-- No CASCADE: unexpected dependents must stop the migration.
drop trigger if exists agency_officer_change on public.agency_personnel;

drop function if exists public.calculate_agency_officer_stats(text);
drop function if exists public.calculate_officer_trait_stats(text);
drop function if exists public.calculate_overall_rating_stats(jsonb);
drop function if exists public.calculate_rating_stats(jsonb);
drop function if exists public.get_rating_category(numeric);
drop function if exists public.get_rating_category(text);
drop function if exists public.handle_agency_officer_change();
drop function if exists public.handle_review_rating_change();
drop function if exists public.prevent_trait_deletion();
drop function if exists public.prevent_trait_modification();
drop function if exists public.recalculate_all_officer_stats();
drop function if exists public.update_agency_overall_rating(text);
drop function if exists public.update_agency_stats(text);
drop function if exists public.update_officer_overall_rating(text);
drop function if exists public.update_overall_stats();
