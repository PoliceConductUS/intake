# Verification

- The two mapped-source regressions failed before the resolver change: each
  returned the court:docket ID and a generated slug instead of the mapped
  production ID and cached published slug.
- 152 targeted tests pass, covering both producers, same-context convergence,
  retained IDs/slugs, dependent references, unmapped natural IDs and suffixes.
- Typecheck, build, OpenSpec validation (21 items), formatting and diff checks pass.
- Read-only verification with the actual 466-case CourtListener artifact and
  workspace mappings/cache resolves six original case IDs/slugs, 14 personnel
  references and six case links. All other 460 case IDs/slugs remain unchanged.
- Corrections reside only in durable workspace mappings/cache. No case-specific
  IDs or conditions were added to importer code. The local database is unchanged;
  the next normal reset/generation uses these corrections. No acquisition is needed.
- Existing applied mutation history is unchanged. Replaying that old history alone
  is not regeneration and will not incorporate the corrected mappings.
- Workspace evidence: `audits/rebuild-followup-20260923/civil-cases/`.
