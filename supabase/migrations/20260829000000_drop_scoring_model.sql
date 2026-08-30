-- ADR 0029: retire the rubric/trait scoring model. Reports (reviews) are on the
-- new narrative shape and link to officers via review_personnel (officer@agency),
-- never to traits. Dropped intake-side now; the website's own read of these tables
-- (report-detail.ts) is decoupled separately and is not a blocker here.
-- Order: dependents first (review_personnel_ratings FKs into rubrics + traits).
drop table if exists "public"."review_personnel_ratings";
drop table if exists "public"."rubric_labels";
drop table if exists "public"."rubrics";
drop table if exists "public"."traits";
