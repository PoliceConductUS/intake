## Design Summary

Publish source-reported values, including questionable values, with annotations beside the data and in one public downloadable index. The conversation establishes the desired behavior: bad employment dates must not make a person disappear, reported dates remain visible without calculated tenure, and an unusual value is not automatically an error.

## Alternatives Considered

1. Keep omissions and publish logs: small but fails to show records where visitors expect them.
2. Store annotations on their affected records: chosen; shares existing record identity and avoids another tracking system.
3. Separate annotation table with IDs and workflow: unnecessary for the requested display and download.

## Agreed Approach

Use ordinary native DataAnnotation records with canonical IDs and polymorphic subject links. Each item carries `field`, `value`, `type` (`warning`, `error`, or `correction`), `message`, `source_namespace`, and `source_record_id`. Generate `/data-annotations/` with pagination, source-provider/type filters, and CSV downloads of every matching annotation across pages. Correction items also carry replacement_value and supplied evidence. Profile displays and index consume the same annotations.

## Key Decisions

- `type`, not `level` or `severity`; warning/error/correction are currently needed.
- Errors describe demonstrable contradictions/invalid values; warnings identify concerns without claiming they are wrong.
- Show source dates without calculated tenure. Clearly attribute the source facts and our annotation.
- Recalculate warnings/errors once after the entire mutation batch succeeds from final effective values. Correction annotations travel in generated mutations and are replaced per owning record, source namespace and source record ID; other source contributions survive.
- No separate annotation IDs/table/API, notification delivery, or issue-management workflow.
- Source values that a typed database column cannot represent remain literal annotation values; do not invent a replacement.
- Keep this documentation in the active checkout under the user's existing single-worktree preference. No new worktree or application changes are needed for this proposal.

## Open Questions

The agreed feature can be proposed now. Design review identified a separate decision before implementing unresolvable agency addresses: representability and public routing without required geography (see design.md). Implementation choices below are recommendations: reuse existing duration threshold as a warning trigger (not a validity limit), use the site's existing page-size convention, and generate finite provider/type filter combinations at build time. None establishes that a flagged source fact is false.

Latest user refinement: calculate/reset annotations once after all mutations succeed by inspecting final database records, rather than generating warnings/errors per import record. Corrections are generated with mutations and preserved by the scan. Licensing-authority pages also need their own paginated source-specific view.

Applied correction annotations travel with generated mutations. Replace the complete correction contribution for each processed owning record plus source namespace and source record ID, including explicit empty replacements. An applied override contributes even if the effective value is unchanged; unprocessed contributions and other sources survive. Final warnings/errors inspect corrected effective values and can coexist with corrections.
