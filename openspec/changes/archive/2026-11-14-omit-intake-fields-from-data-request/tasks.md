## 1. Generator

- [x] 1.1 Add failing cases to `test/data-request-doc.test.ts` for the omitted Institute-controlled fields and record types
- [x] 1.2 Omit the Institute-controlled fields and the `AgencyArrestProfile`, `DataAnnotation`, and `PersonnelPhoto` kinds in `scripts/lib/data-request-doc-generator.ts`

## 2. Document

- [x] 2.1 Regenerate `docs/data-request-format.md` against a database built from the migrations
- [x] 2.2 Add `test/generated-files.integration.test.ts` comparing committed generated files with generator output

## 3. Validation

- [x] 3.1 Run `npm run validate`
