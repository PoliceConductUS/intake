## 1. Import Command Surface

- [x] 1.1 Add CLI coverage for `intake import manifest <manifest-ref>`, missing path, extra arguments, help text, and unknown nested import targets.
- [x] 1.2 Implement nested `import manifest` command routing in `src/cli.ts` without changing existing `validate` behavior.

## 2. Manifest and Mapping Inputs

- [x] 2.1 Add focused tests for readable manifest parsing, malformed YAML, unsupported `apiVersion`, unsupported `kind`, and missing `metadata.namespace`.
- [x] 2.2 Add manifest parsing and validation code for the supported `policeconduct.org/intake/v1alpha1` `ImportPackage` shape.
- [x] 2.3 Add tests for `$INTAKE_WORKSPACE/intake/sources/<namespace>/` selection, malformed mapping files, object-map shape validation, and required mapping record fields.
- [x] 2.4 Add mapping file read, validation, canonical ID assignment with `@paralleldrive/cuid2`, and persistence before database writes.

## 3. Row Transformation

- [x] 3.1 Add transformation tests for agencies, personnel, agency-personnel relationships, unsupported manifest fields, and source-key foreign-key rewriting.
- [x] 3.2 Implement transformations from manifest entities plus mapping records into rows for `public.agency`, `public.officers`, and `public.agency_officers`.
- [x] 3.3 Add tests that agency-personnel entities referencing unmapped agencies or personnel fail before database writes.

## 4. Database Writes

- [x] 4.1 Add tests for missing `DATABASE_URL`, failed database connection, successful write ordering, database write failure, and duplicate constraint failure surfacing.
- [x] 4.2 Implement database connection and direct insert writes through `DATABASE_URL` without `ON CONFLICT`, upsert, or `DO NOTHING`.
- [x] 4.3 Ensure the command never reports success after a partial import failure.

## 5. MN POST Mapping Setup

- [x] 5.1 Create `$INTAKE_WORKSPACE/intake/sources/mn-post/` from the current MN POST manifest and current `supabase/seed.sql` as checked-in setup data, not as a CLI-generated product feature.
- [x] 5.2 Include the known seeded MN POST agency, personnel, and agency-personnel mappings named in the spec.
- [x] 5.3 Add integrity tests or assertions that the known seeded mapping IDs, slugs, location path ID, and coordinates remain present.

## 6. Validation

- [x] 6.1 Run `npm test`.
- [x] 6.2 Run `npm run build`.
- [x] 6.3 Run `npm run openspec:validate`.
- [x] 6.4 Run the narrowest Supabase validation available for the mapping and import risk; if a database reset or import smoke test cannot run, record the exact reason.
