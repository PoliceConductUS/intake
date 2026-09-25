-- ADR 0029 / ADR 0030: intake-emitted reports store no submitter, so reviews
-- cannot carry a user_id. Making it nullable is the non-breaking interim step;
-- the column (and profiles) are dropped in the coordinated last phase, after the
-- display rewrite. Existing rows keep their user_id until then.
alter table "public"."reviews" alter column "user_id" drop not null;
