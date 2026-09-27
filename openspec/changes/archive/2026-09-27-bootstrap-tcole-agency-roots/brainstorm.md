# Agreed outcome

The user requested that TCOLE imports into an empty database start with an existing agency root list, and directed reading the live production sitemap for matching TX agency slugs. Capture that list as durable input, map exact slugs to saved canonical agency IDs and existing TCOLE source-name mappings, and union those roots with ordinary open-assignment/case roots only when the agency table is empty. Existing shared validation and explicit exclusions remain effective. No inferred name matching, new IDs for old agencies, or viewer work.
