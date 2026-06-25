# Manifest Database Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `intake import manifest <manifest-ref>` so a source-produced `ImportPackage` manifest can be validated, resolved through durable source mappings, transformed, and written directly to the database configured by `DATABASE_URL`.

**Architecture:** Keep `src/cli.ts` responsible for command routing and move import behavior into focused modules under `src/import/`. The pipeline order is manifest read/validate, mapping read/validate and canonical ID persistence, row transformation, database connectivity check, then direct inserts without conflict masking.

**Tech Stack:** Node 24, TypeScript, Commander, Vitest, Supabase PostgreSQL through `DATABASE_URL`, `yaml` for YAML parsing, `@paralleldrive/cuid2` for canonical ID assignment, and a minimal PostgreSQL client selected during implementation after checking current published versions.

---

## Task 1: CLI Command Surface

**Files:**

- Modify: `src/cli.ts`
- Modify: `test/cli.test.ts`

- [ ] **Step 1: Add failing CLI routing tests**

Add tests to `test/cli.test.ts` for:

```ts
expect(await runIntake(["import"])).toMatchObject({
  exitCode: 1,
});
expect(await runIntake(["import", "manifest"])).toMatchObject({
  exitCode: 1,
});
expect(
  await runIntake(["import", "manifest", "one.yaml", "extra"]),
).toMatchObject({
  exitCode: 1,
});
expect(await runIntake(["import", "mn", "post"])).toMatchObject({
  exitCode: 1,
});
```

Assert stderr contains specific help text for each invalid shape and that existing `validate` tests still pass.

- [ ] **Step 2: Run the focused CLI tests and verify failure**

Run: `npm test -- test/cli.test.ts`

Expected: FAIL because `import` is currently an unknown command.

- [ ] **Step 3: Add nested import routing**

Update `src/cli.ts` so root help lists:

```text
  import manifest <manifest-ref>  Import a source-produced manifest into DATABASE_URL
```

Add an `import` command with a `manifest` subcommand. For now, have the action call an exported `runImportManifestCommand(manifestRef)` function that returns a clear not-yet-implemented failure until Task 2 adds the pipeline.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- test/cli.test.ts`

Expected: PASS for argument validation and existing `validate` behavior; the successful manifest path can still fail with the explicit not-yet-implemented message until later tasks replace it.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat(cli): route manifest import command"
```

## Task 2: Manifest Parsing and Validation

**Files:**

- Create: `src/import/manifest.ts`
- Create: `test/import-manifest.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Add manifest validation tests**

Create `test/import-manifest.test.ts` with temporary-file fixtures for:

- readable valid manifest with `apiVersion: policeconduct.org/intake/v1alpha1`, `kind: ImportPackage`, and `metadata.namespace`
- missing file
- directory path
- malformed YAML
- unsupported `apiVersion`
- unsupported `kind`
- missing `metadata.namespace`

Use assertions against exported functions, not only CLI stderr.

- [ ] **Step 2: Run focused manifest tests and verify failure**

Run: `npm test -- test/import-manifest.test.ts`

Expected: FAIL because `src/import/manifest.ts` does not exist.

- [ ] **Step 3: Implement manifest read and validation**

Create `src/import/manifest.ts` with exports:

```ts
export type ImportPackageManifest = {
  apiVersion: "policeconduct.org/intake/v1alpha1";
  kind: "ImportPackage";
  spec: {
    // namespace is metadata.namespace
    entities?: {
      agencies?: Record<string, unknown>;
      personnel?: Record<string, unknown>;
      agencyPersonnel?: Record<string, unknown>;
    };
  };
};

export async function readImportPackageManifest(
  path: string,
): Promise<ImportPackageManifest>;
```

Fail with explicit error messages before returning if the file cannot be read, parsed, or validated.

- [ ] **Step 4: Wire CLI to manifest validation**

Have `runImportManifestCommand` call `readImportPackageManifest` and return the validation error text on failure. Keep database work unimplemented until later tasks.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- test/import-manifest.test.ts test/cli.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/import/manifest.ts src/cli.ts test/import-manifest.test.ts test/cli.test.ts
git commit -m "feat(import): validate import package manifests"
```

## Task 3: Source Mapping Ledger

**Files:**

- Create: `src/import/source-mappings.ts`
- Create: `test/source-mappings.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Check dependency versions**

Run:

```bash
npm view yaml version
npm view @paralleldrive/cuid2 version
```

Use the current published versions when adding dependencies.

- [ ] **Step 2: Install mapping dependencies**

Run: `npm install yaml @paralleldrive/cuid2`

Expected: `package.json` and `package-lock.json` update.

- [ ] **Step 3: Add failing mapping tests**

Create `test/source-mappings.test.ts` for:

- namespace `mn-post` resolves to `$INTAKE_WORKSPACE/intake/sources/mn-post/`
- unreadable mapping file fails
- malformed YAML fails
- missing `agencies`, `personnel`, or `agencyPersonnel` object maps fails when needed
- agency mapping requires `canonicalId`, `slug`, `locationPathId`, `latitude`, `longitude`
- personnel mapping requires `canonicalId`, `slug`
- agency-personnel mapping requires `canonicalId`
- missing source entity mapping creates an object record with a new cuid2 `canonicalId`
- updated mappings are persisted before any database writer is called

- [ ] **Step 4: Run focused mapping tests and verify failure**

Run: `npm test -- test/source-mappings.test.ts`

Expected: FAIL because `src/import/source-mappings.ts` does not exist.

- [ ] **Step 5: Implement mapping read, validation, assignment, and persistence**

Create exports:

```ts
export type SourceMappings = {
  agencies: Record<string, AgencyMapping>;
  personnel: Record<string, PersonnelMapping>;
  agencyPersonnel: Record<string, AgencyPersonnelMapping>;
};

export async function loadSourceMappings(
  namespace: string,
): Promise<SourceMappings>;
export async function resolveManifestMappings(
  manifest: ImportPackageManifest,
  mappings: SourceMappings,
): Promise<SourceMappings>;
```

Write the file back only when new mapping records are created. Preserve object-map shape.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- test/source-mappings.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/import/source-mappings.ts test/source-mappings.test.ts
git commit -m "feat(import): resolve source-key mappings"
```

## Task 4: Row Transformation

**Files:**

- Create: `src/import/transform.ts`
- Create: `test/import-transform.test.ts`

- [ ] **Step 1: Add failing transformation tests**

Create fixtures matching the MN POST manifest shapes:

```ts
const agency = {
  id: "a2j...",
  name: "Minnesota State Patrol",
  city: "Saint Paul",
  state: "MN",
  address: "444 Cedar Street",
  zip_code: "55101",
  contact_name: null,
  contact_email: null,
};
const personnel = {
  id: "003...",
  first_name: "Spenser",
  last_name: "Stockwell",
  middle_name: null,
  prefix: null,
  suffix: null,
};
const roster = {
  id: "a2m...",
  agency_id: "a2j...",
  officer_id: "003...",
  badge_number: "49112",
  start_date: "2020-01-01",
  end_date: null,
  title: "Trooper",
};
```

Assert agency rows use mapping `canonicalId`, `slug`, `locationPathId`, `latitude`, and `longitude`; officer rows use mapped `canonicalId` and `slug`; agency-officer rows rewrite `agency_id` and `officer_id` to canonical IDs.

- [ ] **Step 2: Run focused transformation tests and verify failure**

Run: `npm test -- test/import-transform.test.ts`

Expected: FAIL because `src/import/transform.ts` does not exist.

- [ ] **Step 3: Implement row transformation**

Create:

```ts
export type ImportRows = {
  agencies: AgencyRow[];
  officers: OfficerRow[];
  agencyOfficers: AgencyOfficerRow[];
};

export function transformImportPackage(
  manifest: ImportPackageManifest,
  mappings: SourceMappings,
): ImportRows;
```

Ignore unsupported manifest fields. Throw before returning when an agency-personnel source record references an unmapped agency or personnel.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- test/import-transform.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/import/transform.ts test/import-transform.test.ts
git commit -m "feat(import): transform manifest entities"
```

## Task 5: Database Writer and Pipeline

**Files:**

- Create: `src/import/database.ts`
- Create: `src/import/import-manifest.ts`
- Create: `test/import-database.test.ts`
- Modify: `src/cli.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Check PostgreSQL client version**

Run: `npm view pg version`

Use the current published version unless the repo already has a better PostgreSQL client available.

- [ ] **Step 2: Install database dependency**

Run: `npm install pg`

If TypeScript needs declarations, run `npm install -D @types/pg` after checking the current version with `npm view @types/pg version`.

- [ ] **Step 3: Add failing database writer tests**

In `test/import-database.test.ts`, use dependency injection so tests do not need a live database for unit coverage. Cover:

- missing `DATABASE_URL` fails before write
- connection failure fails before write
- agency rows are inserted before officers and agency officers
- SQL text does not contain `ON CONFLICT`, `DO NOTHING`, or upsert behavior
- writer failure returns failure and the CLI does not report success

- [ ] **Step 4: Run focused database tests and verify failure**

Run: `npm test -- test/import-database.test.ts`

Expected: FAIL because writer modules do not exist.

- [ ] **Step 5: Implement database writer**

Create `writeImportRows(rows, options)` in `src/import/database.ts`. Use parameterized inserts for `public.agency`, `public.officers`, and `public.agency_officers`. Open and verify the connection before issuing inserts.

- [ ] **Step 6: Implement import pipeline**

Create `importManifest(path)` in `src/import/import-manifest.ts` that runs:

```text
read manifest -> load mappings -> resolve/persist mappings -> transform rows -> connect/write rows
```

Return a structured command result with inserted row counts only after all writes succeed.

- [ ] **Step 7: Wire CLI to the pipeline**

Update `runImportManifestCommand` in `src/cli.ts` to call `importManifest`. Success stdout should include counts for agencies, officers, and agency-officers. Failure stderr should be explicit and nonzero.

- [ ] **Step 8: Run focused tests**

Run: `npm test -- test/import-database.test.ts test/cli.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/cli.ts src/import/database.ts src/import/import-manifest.ts test/import-database.test.ts
git commit -m "feat(import): write manifest rows to database"
```

## Task 6: Initial MN POST Mapping Setup

**Files:**

- Create: `$INTAKE_WORKSPACE/intake/sources/mn-post/`
- Create or modify: `test/source-mappings.test.ts`

- [ ] **Step 1: Generate the initial mapping file as implementation setup**

Use the current manifest at:

```text
/Users/dalelotts/dev/PoliceConductUS/intake.com.site.my.mnitservices.POSTLicenseSearch/.worktrees/import-minnesota-post-data/.manual-test/mn-post/runs/2026-06-07T00-00-00Z-manual/manifest.yaml
```

Use current `supabase/seed.sql` as the source of known existing canonical IDs and slugs. This generation is manual implementation setup, not a product CLI command.

- [ ] **Step 2: Add the known required mappings**

Ensure `$INTAKE_WORKSPACE/intake/sources/mn-post/` includes:

```yaml
agencies:
  a2j40000000crR2AAI:
    canonicalId: cm90a1b2c3d4e5f6g7h8i9j1l
    slug: minnesota-state-patrol-d4e5f6
    locationPathId: c8gr6bl9bb9i9rmwgo95gord
    latitude: 44.9486036
    longitude: -93.0953582
personnel:
  003t000000MgMrLAAV:
    canonicalId: cm90b1c2d3e4f5g6h7i8j9k2n
    slug: spenser-stockwell-h7i8j9
  0034000001mtGzaAAE:
    canonicalId: cm90b1c2d3e4f5g6h7i8j9k3o
    slug: john-farmakes-k0l1m2
agencyPersonnel:
  a2mt0000000ncuQAAQ:
    canonicalId: cm90c1d2e3f4g5h6i7j8k9l2o
  a2m40000000oVI3AAM:
    canonicalId: cm90c1d2e3f4g5h6i7j8k9l3p
```

- [ ] **Step 3: Add integrity tests for seeded mapping records**

Extend `test/source-mappings.test.ts` to load `$INTAKE_WORKSPACE/intake/sources/mn-post/` and assert the known mapping fields exactly match the spec.

- [ ] **Step 4: Run mapping tests**

Run: `npm test -- test/source-mappings.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add $INTAKE_WORKSPACE/intake/sources/mn-post/ test/source-mappings.test.ts
git commit -m "feat(import): seed mn post source mappings"
```

## Task 7: End-to-End Validation

**Files:**

- Modify: `openspec/changes/import-manifest-to-database/tasks.md`

- [ ] **Step 1: Run unit tests**

Run: `npm test`

Expected: all Vitest tests pass.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: TypeScript build passes.

- [ ] **Step 3: Run OpenSpec validation**

Run: `npm run openspec:validate`

Expected: all specs and changes validate.

- [ ] **Step 4: Run Supabase validation or record blocker**

Run the narrowest available command that exercises migrations, seed loading, and the mapping/import path. Start with:

```bash
npm run supabase:reset
```

If local Supabase is unavailable, record the exact command output and reason in the final implementation report.

- [ ] **Step 5: Mark tasks complete**

Update `openspec/changes/import-manifest-to-database/tasks.md` checkboxes to `- [x]` only for tasks actually completed and verified.

- [ ] **Step 6: Final commit**

```bash
git add openspec/changes/import-manifest-to-database/tasks.md
git commit -m "chore(openspec): complete manifest import tasks"
```

## Self-Review

- Spec coverage: The plan covers command routing, manifest validation, per-source mappings, canonical ID assignment, MN POST mapping shape, transformations, relationship rewriting, database writes, duplicate conflict behavior, and initial mapping setup.
- Placeholder scan: No placeholder markers are intentionally left in this plan.
- Type consistency: Later tasks consume `ImportPackageManifest`, `SourceMappings`, and `ImportRows` introduced in earlier tasks.
