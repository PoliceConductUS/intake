
create or replace view "public"."agency_states" as  SELECT DISTINCT agency.state
   FROM agency
  ORDER BY agency.state;
