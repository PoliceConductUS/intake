-- ADR 0029: retire the old logged-in-account model. Submissions are now anonymous
-- with email verification (the bucket's verify/ records), so no submitter/account
-- is stored. Reports link to officers via review_personnel (officer@agency), never
-- to a submitter. The website's own reads of these tables are decoupled separately
-- and are not a blocker here.

-- Drop the submitter/audit foreign keys into profiles first.
alter table "public"."reviews" drop column if exists "user_id";
alter table "public"."review_witnesses" drop column if exists "profile_id";
drop table if exists "public"."audit_logs";

-- Then profiles and its children.
drop table if exists "public"."profile_emails";
drop table if exists "public"."profile_links";
drop table if exists "public"."profile_phone_numbers";
drop table if exists "public"."profiles";
