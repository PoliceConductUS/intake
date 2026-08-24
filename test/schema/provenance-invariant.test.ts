/**
 * Demonstrated enforcement of the provenance invariant.
 *
 * These tests are the evidence for INS-5's "done when" clause. Each one tries
 * to do the thing the invariant is supposed to make impossible and asserts
 * that the database refuses.
 *
 * Requires a Postgres connection string in TEST_DATABASE_URL. The suite skips
 * itself when that is absent so `npm test` stays green without a database.
 * TEST_DATABASE_URL must be a fully-qualified URL with a host, because the
 * render-role tests rewrite its credentials.
 *
 * Two modes, chosen by whether the target database has the real upstream
 * schema (detected via `agency.location_path_id`):
 *
 *   Real-schema mode (a `supabase db reset` database). The migration set is
 *   already applied, so the suite runs against it as it stands -- against the
 *   real `agency`/`officers` definitions, with Supabase's own roles and
 *   default privileges present. It rebuilds nothing, clears only the rows it
 *   created, and refuses to run if the database holds data it did not create.
 *   This is the mode that proves the migration composes with the real schema.
 *
 *     npm run supabase:start && npm run supabase:reset
 *     TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres \
 *       npx vitest run test/schema
 *
 *   Fixture mode (a bare Postgres with no upstream schema, e.g. a host with no
 *   PostGIS). `upstream-fixture.sql` stands in for the three upstream objects
 *   the migration references and the schema is rebuilt in place.
 *
 *     createdb intake_schema_test
 *     TEST_DATABASE_URL=postgres://localhost:5432/intake_schema_test \
 *       npm run test:vitest -- test/schema
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const MIGRATION_PATH = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260824170000_provenance_structural_invariant.sql",
    import.meta.url,
  ),
);
const FIXTURE_PATH = fileURLToPath(
  new URL("./upstream-fixture.sql", import.meta.url),
);

/**
 * Every table the provenance migration creates, for the real-schema-mode
 * reset. Truncating these is what makes the suite re-runnable there; it is
 * guarded by the emptiness check in `beforeAll`, so it can only ever remove
 * this suite's own leftovers.
 */
const PROVENANCE_TABLES = [
  "person_identity_link",
  "employment_period",
  "person_name_variant",
  "person",
  "agency_registry_presence",
  "ori_conflict",
  "agency_ori",
  "agency_entity_member",
  "agency_entity",
  "publication_event",
  "subject_suppression",
  "claim",
  "claim_predicate",
  "source_retrieval",
  "source",
];

const RETRIEVAL = "ret_test_0001";
const SOURCE = "src_test_0001";
const AGENCY_A = "agency_test_a";
const AGENCY_B = "agency_test_b";
const LOCATION_PATH = "locpath_test_tx";

let admin: Client;

/** Connection string actually under test. */
let testUrl: string;

/** True when running against a real migrated (`supabase db reset`) database. */
let realSchema = false;

/** Run SQL and return the error message, or null if it unexpectedly succeeded. */
async function rejects(sql: string, params: unknown[] = []): Promise<string> {
  try {
    await admin.query(sql, params);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`expected statement to be rejected but it succeeded: ${sql}`);
}

describe.skipIf(!DATABASE_URL)("provenance structural invariant", () => {
  beforeAll(async () => {
    // Decide the mode BEFORE touching anything. This check has to precede the
    // schema drops below: dropping `public` first would guarantee `agency` is
    // absent, so the fixture would always win and the suite would never
    // exercise the real schema it claims to.
    //
    // The marker is `agency.location_path_id`, not the existence of `agency`.
    // The fixture creates an `agency` too, so keying off the table would make
    // the second fixture-mode run mistake its own leftovers for the real
    // schema. Only the real migration set adds this column.
    const bootstrap = new Client({ connectionString: DATABASE_URL });
    await bootstrap.connect();
    realSchema = (
      await bootstrap.query(
        `select exists (
           select 1 from information_schema.columns
           where table_schema = 'public'
             and table_name = 'agency'
             and column_name = 'location_path_id'
         ) as present`,
      )
    ).rows[0].present as boolean;

    if (realSchema) {
      // Real-schema mode: the target already has the full migration set
      // applied by `supabase db reset`, including this migration. Use it as
      // it stands -- that artifact, with Supabase's own roles and default
      // privileges present, is exactly what we need to test. Do not rebuild
      // the schema: replaying migrations into a blank database does not work
      // (they reference Supabase bootstrap schemas such as `graphql` that
      // `create database` does not provide), and dropping `public` here would
      // destroy the developer's stack.
      testUrl = DATABASE_URL!;
      admin = bootstrap;

      // Refuse to touch a database with real data in it. A freshly reset
      // database has no agencies; anything else is not a test database.
      const strays = await admin.query(
        `select count(*)::int as n from public.agency where id <> all($1::text[])`,
        [[AGENCY_A, AGENCY_B]],
      );
      if (strays.rows[0].n > 0) {
        throw new Error(
          `refusing to run: public.agency holds ${strays.rows[0].n} row(s) this suite did not create. ` +
            `Point TEST_DATABASE_URL at a freshly reset database (npm run supabase:reset).`,
        );
      }

      // Re-runnable: clear this suite's leftovers from a previous run.
      await admin.query(
        `truncate table ${PROVENANCE_TABLES.map((t) => `public.${t}`).join(", ")} cascade`,
      );
      await admin.query(
        `delete from public.agency where id = any($1::text[])`,
        [[AGENCY_A, AGENCY_B]],
      );
      await admin.query(
        `delete from public.location_path where location_path_id = $1`,
        [LOCATION_PATH],
      );
    } else {
      // Fixture mode: a bare Postgres with no upstream schema. Rebuild in
      // place and stand in for the three objects the migration references.
      testUrl = DATABASE_URL!;
      admin = bootstrap;

      // Start from a known-empty state so the suite is re-runnable.
      await admin.query(`drop schema if exists render cascade`);
      await admin.query(`drop schema if exists public cascade`);
      await admin.query(`create schema public`);
      await admin.query(`drop owned by page_renderer`).catch(() => {});
      await admin.query(`drop role if exists page_renderer`).catch(() => {});

      await admin.query(readFileSync(FIXTURE_PATH, "utf8"));
      await admin.query(readFileSync(MIGRATION_PATH, "utf8"));
    }

    // A cleared source and one retrieval, used by most tests below.
    await admin.query(
      `insert into public.source
         (source_id, slug, name, publisher, access_basis, terms_status,
          terms_reviewed_at, terms_reviewed_by)
       values ($1, 'fbi-cde-agency-registry', 'FBI CDE Agency Registry',
               'Federal Bureau of Investigation', 'public_api', 'cleared',
               now(), 'founding-engineer')`,
      [SOURCE],
    );
    await admin.query(
      `insert into public.source_retrieval
         (retrieval_id, source_id, retrieved_at, source_url, content_hash)
       values ($1, $2, now(), 'https://api.usa.gov/crime/fbi/cde/agency', 'sha256:test')`,
      [RETRIEVAL, SOURCE],
    );
    await admin.query(
      `insert into public.claim_predicate
         (predicate, subject_type, datatype, description, renderable)
       values
         ('agency.name', 'agency', 'text', 'Agency display name', true),
         ('agency.latitude', 'agency', 'number', 'Latitude', true),
         ('agency.agency_type_name', 'agency', 'text',
          'Source classification; inconsistent across states, internal only', false)`,
    );
    if (realSchema) {
      // The real `agency` carries two NOT NULL columns the fixture does not:
      // `slug` and a restricted FK to `location_path`. Seeding them here is
      // the difference between testing the real table and testing a stand-in.
      await admin.query(
        `insert into public.location_path
           (location_path_id, path, level, state_or_territory_slug,
            state_or_territory_name)
         values ($1, '/tx', 'state', 'tx', 'Texas')
         on conflict (location_path_id) do nothing`,
        [LOCATION_PATH],
      );
      await admin.query(
        `insert into public.agency (id, name, state, slug, location_path_id)
         values ($1, 'Test Police Department', 'TX', 'test-police-department', $3),
                ($2, 'Other Police Department', 'TX', 'other-police-department', $3)`,
        [AGENCY_A, AGENCY_B, LOCATION_PATH],
      );
    } else {
      await admin.query(
        `insert into public.agency (id, name, state) values
           ($1, 'Test Police Department', 'TX'),
           ($2, 'Other Police Department', 'TX')`,
        [AGENCY_A, AGENCY_B],
      );
    }
  });

  afterAll(async () => {
    await admin?.end();
  });

  // -- Half one: an uncited value cannot exist ------------------------------

  it("refuses a claim with no retrieval", async () => {
    const message = await rejects(
      `insert into public.claim
         (claim_id, subject_type, subject_id, predicate, value_text,
          source_record_key, confidence, confidence_basis)
       values ('c_no_prov', 'agency', $1, 'agency.name', 'Uncited PD',
               'src-1', 0.9, 'source_asserted')`,
      [AGENCY_A],
    );
    expect(message).toMatch(/retrieval_id/);
    expect(message).toMatch(/not-null|null value/i);
  });

  it("refuses a retrieval with neither a source URL nor a records-request id", async () => {
    const message = await rejects(
      `insert into public.source_retrieval
         (retrieval_id, source_id, retrieved_at, content_hash)
       values ('ret_no_locator', $1, now(), 'sha256:x')`,
      [SOURCE],
    );
    expect(message).toMatch(/source_retrieval_locator_required/);
  });

  it("accepts a records-request identifier as the locator", async () => {
    await admin.query(
      `insert into public.source_retrieval
         (retrieval_id, source_id, retrieved_at, records_request_id, content_hash)
       values ('ret_foia', $1, now(), 'TCOLE-PIR-2026-0417', 'sha256:y')`,
      [SOURCE],
    );
    const { rows } = await admin.query(
      `select records_request_id from public.source_retrieval where retrieval_id = 'ret_foia'`,
    );
    expect(rows[0].records_request_id).toBe("TCOLE-PIR-2026-0417");
  });

  it("refuses confidence outside (0, 1]", async () => {
    const message = await rejects(
      `insert into public.claim
         (claim_id, subject_type, subject_id, predicate, value_text,
          retrieval_id, source_record_key, confidence, confidence_basis)
       values ('c_bad_conf', 'agency', $1, 'agency.name', 'X', $2, 'k', 0, 'source_asserted')`,
      [AGENCY_A, RETRIEVAL],
    );
    expect(message).toMatch(/confidence/);
  });

  it("refuses a value whose type does not match the declared predicate", async () => {
    const message = await rejects(
      `insert into public.claim
         (claim_id, subject_type, subject_id, predicate, value_text,
          retrieval_id, source_record_key, confidence, confidence_basis)
       values ('c_wrong_type', 'agency', $1, 'agency.latitude', 'thirty-one',
               $2, 'k', 0.9, 'source_asserted')`,
      [AGENCY_A, RETRIEVAL],
    );
    expect(message).toMatch(/declared as number/);
  });

  it("refuses an unregistered predicate", async () => {
    const message = await rejects(
      `insert into public.claim
         (claim_id, subject_type, subject_id, predicate, value_text,
          retrieval_id, source_record_key, confidence, confidence_basis)
       values ('c_unreg', 'agency', $1, 'agency.secret_field', 'x',
               $2, 'k', 0.9, 'source_asserted')`,
      [AGENCY_A, RETRIEVAL],
    );
    expect(message).toMatch(/claim_predicate|foreign key/i);
  });

  it("records a source-asserted null as a cited absence, not a missing row", async () => {
    await admin.query(
      `insert into public.claim
         (claim_id, subject_type, subject_id, predicate, value_absent,
          retrieval_id, source_record_key, confidence, confidence_basis,
          publication_status)
       values ('c_absent_lat', 'agency', $1, 'agency.latitude', true,
               $2, 'tx-0001', 1.0, 'source_asserted', 'published')`,
      [AGENCY_A, RETRIEVAL],
    );
    const { rows } = await admin.query(
      `select cited_value from render.published_claim
        where subject_id = $1 and predicate = 'agency.latitude'`,
      [AGENCY_A],
    );
    expect(rows[0].cited_value.absent).toBe(true);
    expect(rows[0].cited_value.value).toBeNull();
    // The absence still carries a full citation.
    expect(rows[0].cited_value.citation.source).toBe("fbi-cde-agency-registry");
    expect(rows[0].cited_value.citation.retrievedAt).toBeTruthy();
  });

  it("keeps retrievals append-only so a citation date cannot be rewritten", async () => {
    const message = await rejects(
      `update public.source_retrieval set retrieved_at = now() - interval '1 year'
        where retrieval_id = $1`,
      [RETRIEVAL],
    );
    expect(message).toMatch(/append-only/);
  });

  // -- Half two: the render path cannot read an uncited value ---------------

  describe("least-privilege render role", () => {
    let renderer: Client;

    beforeAll(async () => {
      await admin.query(`alter role page_renderer login password 'test-only'`);

      // `pg` ignores the `user`/`password` options when `connectionString` is
      // also supplied, so the credentials must be embedded in the URL. Getting
      // this wrong silently connects as the superuser and turns every
      // permission assertion below into a false pass.
      const url = new URL(testUrl);
      url.username = "page_renderer";
      url.password = "test-only";
      renderer = new Client({ connectionString: url.toString() });
      await renderer.connect();

      // Guard the guard. If this ever fails, the permission tests are
      // meaningless and must not be allowed to report green.
      const who = await renderer.query(`select current_user`);
      expect(who.rows[0].current_user).toBe("page_renderer");
    });

    afterAll(async () => {
      await renderer?.end();
      await admin.query(`alter role page_renderer nologin`).catch(() => {});
    });

    it("cannot read the claim table directly", async () => {
      await expect(
        renderer.query(`select * from public.claim`),
      ).rejects.toThrow(/permission denied/i);
    });

    it("cannot read the agency table directly", async () => {
      await expect(
        renderer.query(`select name from public.agency`),
      ).rejects.toThrow(/permission denied/i);
    });

    it("cannot read the legacy officers table directly", async () => {
      await expect(
        renderer.query(`select first_name from public.officers`),
      ).rejects.toThrow(/permission denied/i);
    });

    it("cannot select a bare value column from the render view", async () => {
      // The columns do not exist. This is the point: there is no SQL that
      // returns a value without its citation.
      await expect(
        renderer.query(`select value_text from render.published_claim`),
      ).rejects.toThrow(/column .*value_text.* does not exist/i);
    });

    it("returns value and citation as one indivisible column", async () => {
      await admin.query(
        `insert into public.claim
           (claim_id, subject_type, subject_id, predicate, value_text,
            retrieval_id, source_record_key, confidence, confidence_basis,
            publication_status)
         values ('c_pub_name', 'agency', $1, 'agency.name', 'Test Police Department',
                 $2, 'tx-0001', 0.99, 'source_asserted', 'published')`,
        [AGENCY_A, RETRIEVAL],
      );

      const { rows } = await renderer.query(
        `select cited_value from render.published_claim
          where subject_id = $1 and predicate = 'agency.name'`,
        [AGENCY_A],
      );

      expect(rows).toHaveLength(1);
      const cited = rows[0].cited_value;
      expect(cited.value).toBe("Test Police Department");
      expect(cited.citation).toMatchObject({
        source: "fbi-cde-agency-registry",
        publisher: "Federal Bureau of Investigation",
        locatorType: "url",
        locator: "https://api.usa.gov/crime/fbi/cde/agency",
        confidence: 0.99,
        confidenceBasis: "source_asserted",
      });
      expect(cited.citation.retrievedAt).toBeTruthy();
    });

    it("hides staged claims from the render path", async () => {
      await admin.query(
        `insert into public.claim
           (claim_id, subject_type, subject_id, predicate, value_text,
            retrieval_id, source_record_key, confidence, confidence_basis)
         values ('c_staged', 'agency', $1, 'agency.name', 'Staged Name',
                 $2, 'tx-0002', 0.5, 'source_asserted')`,
        [AGENCY_B, RETRIEVAL],
      );
      const { rows } = await renderer.query(
        `select cited_value from render.published_claim where subject_id = $1`,
        [AGENCY_B],
      );
      expect(rows).toHaveLength(0);
    });

    it("is not granted access to the personnel view at all", async () => {
      await expect(
        renderer.query(`select * from render.published_person`),
      ).rejects.toThrow(/permission denied/i);
    });

    it("removes a subject from render the moment it is suppressed", async () => {
      const before = await renderer.query(
        `select count(*)::int as n from render.published_claim where subject_id = $1`,
        [AGENCY_A],
      );
      expect(before.rows[0].n).toBeGreaterThan(0);

      await admin.query(
        `insert into public.subject_suppression
           (suppression_id, subject_type, subject_id, reason_code, applied_by)
         values ('sup_1', 'agency', $1, 'accuracy_dispute', 'founding-engineer')`,
        [AGENCY_A],
      );

      const during = await renderer.query(
        `select count(*)::int as n from render.published_claim where subject_id = $1`,
        [AGENCY_A],
      );
      expect(during.rows[0].n).toBe(0);

      await admin.query(
        `update public.subject_suppression
            set lifted_at = now(), lifted_by = 'founding-engineer'
          where suppression_id = 'sup_1'`,
      );

      const after = await renderer.query(
        `select count(*)::int as n from render.published_claim where subject_id = $1`,
        [AGENCY_A],
      );
      expect(after.rows[0].n).toBeGreaterThan(0);
    });
  });

  // -- Publication policy ---------------------------------------------------

  it("refuses to publish a claim on a non-renderable predicate", async () => {
    const message = await rejects(
      `insert into public.claim
         (claim_id, subject_type, subject_id, predicate, value_text,
          retrieval_id, source_record_key, confidence, confidence_basis,
          publication_status)
       values ('c_type_name', 'agency', $1, 'agency.agency_type_name', 'State Police',
               $2, 'tx-0001', 0.9, 'source_asserted', 'published')`,
      [AGENCY_A, RETRIEVAL],
    );
    expect(message).toMatch(/not renderable/);
  });

  it("refuses to publish a claim backed by a source whose terms are not cleared", async () => {
    await admin.query(
      `insert into public.source
         (source_id, slug, name, publisher, access_basis, terms_status)
       values ('src_uncleared', 'npi', 'National Police Index', 'NPI',
               'public_bulk_download', 'under_review')`,
    );
    await admin.query(
      `insert into public.source_retrieval
         (retrieval_id, source_id, retrieved_at, source_url, content_hash)
       values ('ret_uncleared', 'src_uncleared', now(), 'https://example.org/x', 'sha256:z')`,
    );
    const message = await rejects(
      `insert into public.claim
         (claim_id, subject_type, subject_id, predicate, value_text,
          retrieval_id, source_record_key, confidence, confidence_basis,
          publication_status)
       values ('c_uncleared', 'agency', $1, 'agency.name', 'X',
               'ret_uncleared', 'k', 0.9, 'source_asserted', 'published')`,
      [AGENCY_B],
    );
    expect(message).toMatch(/terms_status=under_review/);
  });

  it("writes an audit event for every publication-status transition", async () => {
    await admin.query(`set intake.actor = 'founding-engineer'`);
    await admin.query(`set intake.reason_code = 'gate_cleared'`);
    await admin.query(
      `update public.claim set publication_status = 'published' where claim_id = 'c_staged'`,
    );
    await admin.query(
      `update public.claim set publication_status = 'blocked' where claim_id = 'c_staged'`,
    );

    const { rows } = await admin.query(
      `select from_status, to_status, actor, reason_code
         from public.publication_event
        where claim_id = 'c_staged'
        order by occurred_at`,
    );

    // insert(staged) -> published -> blocked
    expect(rows.map((r) => r.to_status)).toEqual([
      "staged",
      "published",
      "blocked",
    ]);
    expect(rows[1].from_status).toBe("staged");
    expect(rows[2].from_status).toBe("published");
    expect(rows[2].actor).toBe("founding-engineer");
    expect(rows[2].reason_code).toBe("gate_cleared");
    await admin.query(`reset intake.actor`);
    await admin.query(`reset intake.reason_code`);
  });

  it("keeps the publication audit trail append-only", async () => {
    const message = await rejects(
      `delete from public.publication_event where claim_id = 'c_staged'`,
    );
    expect(message).toMatch(/append-only/);
  });

  // -- Agency identity ------------------------------------------------------

  describe("ORI identity", () => {
    it("records the ORI form explicitly and rejects a length mismatch", async () => {
      const message = await rejects(
        `insert into public.agency_ori
           (agency_ori_id, agency_id, ori, ori_form, retrieval_id, confidence)
         values ('aori_bad', $1, 'TX0570000', 'ori7', $2, 1.0)`,
        [AGENCY_A, RETRIEVAL],
      );
      expect(message).toMatch(/agency_ori_form_length/);
    });

    it("derives ori7 from a 9-character ORI without overwriting it", async () => {
      await admin.query(
        `insert into public.agency_ori
           (agency_ori_id, agency_id, ori, ori_form, is_primary, retrieval_id, confidence)
         values ('aori_a', $1, 'TX0570000', 'ori9', true, $2, 1.0)`,
        [AGENCY_A, RETRIEVAL],
      );
      const { rows } = await admin.query(
        `select ori, ori_form, ori7 from public.agency_ori where agency_ori_id = 'aori_a'`,
      );
      expect(rows[0]).toMatchObject({
        ori: "TX0570000",
        ori_form: "ori9",
        ori7: "TX05700",
      });
    });

    it("opens a reviewed conflict instead of auto-resolving an ORI collision", async () => {
      await admin.query(
        `insert into public.agency_ori
           (agency_ori_id, agency_id, ori, ori_form, is_primary, retrieval_id, confidence)
         values ('aori_b', $1, 'TX0570001', 'ori9', true, $2, 1.0)`,
        [AGENCY_B, RETRIEVAL],
      );

      const { rows } = await admin.query(
        `select conflict_type, status, evidence from public.ori_conflict where ori7 = 'TX05700'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        conflict_type: "same_ori_multiple_agencies",
        status: "open",
      });
      expect(rows[0].evidence.agency_ids).toEqual(
        expect.arrayContaining([AGENCY_A, AGENCY_B]),
      );
    });

    it("suppresses both agencies from render while the ORI conflict is open", async () => {
      const { rows } = await admin.query(
        `select count(*)::int as n from render.published_agency
          where agency_id in ($1, $2)`,
        [AGENCY_A, AGENCY_B],
      );
      expect(rows[0].n).toBe(0);
    });

    it("refuses to close a conflict without a resolver and a note", async () => {
      const message = await rejects(
        `update public.ori_conflict set status = 'resolved' where ori7 = 'TX05700'`,
      );
      expect(message).toMatch(/ori_conflict_resolution_complete/);
    });

    it("refuses an ORI assignment with no citation", async () => {
      const message = await rejects(
        `insert into public.agency_ori
           (agency_ori_id, agency_id, ori, ori_form, confidence)
         values ('aori_nocite', $1, 'TX0990000', 'ori9', 1.0)`,
        [AGENCY_A],
      );
      expect(message).toMatch(/retrieval_id/);
    });

    it("allows an agency to belong to at most one department entity", async () => {
      await admin.query(
        `insert into public.agency_entity
           (agency_entity_id, state, canonical_name, entity_kind)
         values ('ent_chp', 'CA', 'California Highway Patrol', 'state_police'),
                ('ent_other', 'CA', 'Other Department', 'municipal_police')`,
      );
      await admin.query(
        `insert into public.agency_entity_member
           (membership_id, agency_entity_id, agency_id, confidence, method, evidence)
         values ('mem_1', 'ent_chp', $1, 0.9, 'shared_ori_prefix',
                 '{"ori7_prefix": "CA05700"}')`,
        [AGENCY_A],
      );
      const message = await rejects(
        `insert into public.agency_entity_member
           (membership_id, agency_entity_id, agency_id, confidence, method, evidence)
         values ('mem_2', 'ent_other', $1, 0.9, 'name_pattern', '{}')`,
        [AGENCY_A],
      );
      expect(message).toMatch(/agency_entity_member_unique/);
    });

    it("models absence from a registry as a finding, not a missing row", async () => {
      await admin.query(
        `insert into public.agency_registry_presence
           (presence_id, agency_id, source_id, presence, retrieval_id, note)
         values ('pres_1', $1, $2, 'absent', $3,
                 'Not a UCR reporting participant; existence confirmed by state roster')`,
        [AGENCY_B, SOURCE, RETRIEVAL],
      );
      const { rows } = await admin.query(
        `select presence from public.agency_registry_presence where presence_id = 'pres_1'`,
      );
      expect(rows[0].presence).toBe("absent");
    });
  });

  // -- Personnel identity resolution ---------------------------------------

  describe("personnel identity", () => {
    beforeAll(async () => {
      await admin.query(
        `insert into public.person (person_id) values ('per_a'), ('per_b')`,
      );
      await admin.query(
        `insert into public.person_name_variant
           (name_variant_id, person_id, full_name, first_name, last_name,
            normalized_key, retrieval_id, source_record_key, confidence)
         values
           ('pnv_1', 'per_a', 'Jose Gonzalez', 'Jose', 'Gonzalez',
            'gonzalez|jose', $1, 'tcole-1', 1.0),
           ('pnv_2', 'per_b', 'Jose A. Gonzalez', 'Jose', 'Gonzalez',
            'gonzalez|jose', $1, 'tcole-2', 1.0)`,
        [RETRIEVAL],
      );
    });

    it("has no displayable attribute columns on person", async () => {
      const { rows } = await admin.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'person'`,
      );
      const columns = rows.map((r) => r.column_name).sort();
      // Nothing name-like. A person's name can only exist as a cited variant.
      expect(columns).toEqual([
        "created_at",
        "legacy_officer_id",
        "person_id",
        "updated_at",
      ]);
    });

    it("requires a citation on every name variant", async () => {
      const message = await rejects(
        `insert into public.person_name_variant
           (name_variant_id, person_id, full_name, normalized_key,
            source_record_key, confidence)
         values ('pnv_bad', 'per_a', 'Uncited Name', 'k', 'k', 1.0)`,
      );
      expect(message).toMatch(/retrieval_id/);
    });

    it("links identities without merging rows", async () => {
      await admin.query(
        `insert into public.person_identity_link
           (link_id, person_id_a, person_id_b, assertion, confidence, method,
            evidence, status)
         values ('lnk_1', 'per_a', 'per_b', 'possible_same_person', 0.72,
                 'name_and_agency_overlap',
                 '{"shared_agency": "TX0570000", "name_similarity": 0.94}', 'proposed')`,
      );
      // Both person rows still exist, untouched. A link is reversible; a merge
      // would not be.
      const { rows } = await admin.query(
        `select count(*)::int as n from public.person where person_id in ('per_a','per_b')`,
      );
      expect(rows[0].n).toBe(2);
    });

    it("refuses an unordered or self-referential identity pair", async () => {
      const selfLink = await rejects(
        `insert into public.person_identity_link
           (link_id, person_id_a, person_id_b, assertion, confidence, method, evidence)
         values ('lnk_self', 'per_a', 'per_a', 'same_person', 1.0, 'manual_review', '{}')`,
      );
      expect(selfLink).toMatch(/person_identity_link_ordered/);

      const reversed = await rejects(
        `insert into public.person_identity_link
           (link_id, person_id_a, person_id_b, assertion, confidence, method, evidence)
         values ('lnk_rev', 'per_b', 'per_a', 'same_person', 1.0, 'manual_review', '{}')`,
      );
      expect(reversed).toMatch(/person_identity_link_ordered/);
    });

    it("refuses to auto-accept a same-person link from a probabilistic method", async () => {
      const message = await rejects(
        `insert into public.person_identity_link
           (link_id, person_id_a, person_id_b, assertion, confidence, method,
            evidence, status, reviewed_by, reviewed_at)
         values ('lnk_auto', 'per_a', 'per_b', 'same_person', 0.99,
                 'probabilistic_score', '{}', 'accepted', 'matcher', now())`,
      );
      expect(message).toMatch(/person_identity_link_same_person_needs_review/);
    });

    it("requires a reviewer on any non-proposed link", async () => {
      const message = await rejects(
        `insert into public.person_identity_link
           (link_id, person_id_a, person_id_b, assertion, confidence, method,
            evidence, status)
         values ('lnk_norev', 'per_a', 'per_b', 'distinct_person', 1.0,
                 'manual_review', '{}', 'accepted')`,
      );
      expect(message).toMatch(/person_identity_link_review_complete/);
    });

    it("keeps rank, badge number and dates as claims rather than columns", async () => {
      const { rows } = await admin.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'employment_period'`,
      );
      const columns = rows.map((r) => r.column_name);
      for (const forbidden of [
        "rank",
        "badge_number",
        "start_date",
        "end_date",
        "license_type",
      ]) {
        expect(columns).not.toContain(forbidden);
      }
    });

    it("refuses an employment period with no citation", async () => {
      const message = await rejects(
        `insert into public.employment_period
           (employment_id, person_id, agency_id, source_record_key, confidence)
         values ('emp_nocite', 'per_a', $1, 'k', 1.0)`,
        [AGENCY_A],
      );
      expect(message).toMatch(/retrieval_id/);
    });

    it("defaults employment to staged, never published", async () => {
      await admin.query(
        `insert into public.employment_period
           (employment_id, person_id, agency_id, retrieval_id, source_record_key, confidence)
         values ('emp_1', 'per_a', $1, $2, 'tcole-1', 1.0)`,
        [AGENCY_A, RETRIEVAL],
      );
      const { rows } = await admin.query(
        `select publication_status from public.employment_period where employment_id = 'emp_1'`,
      );
      expect(rows[0].publication_status).toBe("staged");
    });

    it("keeps the personnel gate closed even for a published employment", async () => {
      await admin.query(
        `update public.employment_period set publication_status = 'published'
          where employment_id = 'emp_1'`,
      );
      const { rows } = await admin.query(
        `select count(*)::int as n from render.published_person`,
      );
      // Second lock: the view itself yields nothing. Opening the gate takes a
      // migration AND a grant.
      expect(rows[0].n).toBe(0);
    });
  });

  // -- The invariant self-check --------------------------------------------

  describe("assert_provenance_invariant", () => {
    it("reports no violations on a correctly migrated database", async () => {
      const { rows } = await admin.query(
        `select violation, detail from public.assert_provenance_invariant()`,
      );
      expect(rows).toEqual([]);
    });

    it("detects a future migration granting the renderer a base table", async () => {
      await admin.query(`grant select on public.claim to page_renderer`);
      const { rows } = await admin.query(
        `select violation, detail from public.assert_provenance_invariant()`,
      );
      expect(rows.map((r) => r.violation)).toContain(
        "renderer_reads_base_table",
      );
      expect(rows.some((r) => r.detail.includes("public.claim"))).toBe(true);
      await admin.query(`revoke select on public.claim from page_renderer`);
    });

    it("detects the personnel gate being opened by a grant", async () => {
      await admin.query(
        `grant select on render.published_person to page_renderer`,
      );
      const { rows } = await admin.query(
        `select violation from public.assert_provenance_invariant()`,
      );
      expect(rows.map((r) => r.violation)).toContain("personnel_gate_open");
      await admin.query(
        `revoke select on render.published_person from page_renderer`,
      );
    });

    it("is clean again once the offending grants are revoked", async () => {
      const { rows } = await admin.query(
        `select violation, detail from public.assert_provenance_invariant()`,
      );
      expect(rows).toEqual([]);
    });
  });
});
