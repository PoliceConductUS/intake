## Decisions

Add nullable `civil_case_id` referencing `civil_cases.id` to `review_links`; URL and title become nullable for case links. A link targets either a URL with a title or a case ID. Preserve unique report-target pairs. The loader separates case relationships from external evidence, joins cases for their current title and slug, and the template renders case links without `target` or `rel` attributes.

## Migration

Apply the additive schema migration, regenerate canonical IO, then acquire the revised manual ReviewLink with the existing source-local name. Generate and apply its recorded update. No URL parsing or source-specific code is used.
