/**
 * Demonstrated enforcement of the corrections and takedown mechanism (INS-9).
 *
 * The issue's done-when clause is: a record can be suppressed, survives a full
 * pipeline re-run still suppressed, and the action is logged. The three
 * describe blocks below are those three clauses, plus the intake path and the
 * public log.
 *
 * The re-run test is the one that matters. It replays the two ways a takedown
 * honoured on Tuesday gets undone on Wednesday:
 *
 *   a) the loader re-imports the same upstream row and overwrites the record;
 *   b) the source-name-to-canonical-ID ledger is regenerated, the loader
 *      assigns a NEW canonical ID to the SAME upstream row, and every
 *      suppression check keyed on the old ID passes.
 *
 * (b) is the one that would actually happen, because that ledger is a YAML
 * file on disk outside the database.
 *
 * Requires a Postgres connection string in TEST_DATABASE_URL. The suite skips
 * itself when that is absent so `npm test` stays green without a database.
 * TEST_DATABASE_URL must be a fully-qualified URL with a host, because the
 * ingestion-role tests rewrite its credentials.
 *
 *   createdb intake_schema_test
 *   TEST_DATABASE_URL=postgres://localhost:5432/intake_schema_test \
 *     npm run test:vitest -- test/schema
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const PROVENANCE_MIGRATION = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260824170000_provenance_structural_invariant.sql",
    import.meta.url,
  ),
);
const CORRECTIONS_MIGRATION = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260824190000_corrections_and_takedown.sql",
    import.meta.url,
  ),
);
const FIXTURE_PATH = fileURLToPath(
  new URL("./upstream-fixture.sql", import.meta.url),
);

const SOURCE = "src_ins9_0001";
const RETRIEVAL = "ret_ins9_0001";
/** A second pull of the same source: what a re-run produces. */
const RETRIEVAL_RERUN = "ret_ins9_0002";

const AGENCY = "agency_ins9_subject";
/** The upstream record key the source uses for that agency. Stable across runs. */
const SOURCE_RECORD_KEY = "TX0570000";
/** The canonical ID a regenerated mapping ledger would assign on a re-run. */
const AGENCY_REIDENTIFIED = "agency_ins9_reidentified";

const SUPPRESSION = "sup_ins9_0001";

let admin: Client;
/** Connected as `intake_writer`: what the loader is supposed to connect as. */
let loader: Client;

/** Run SQL and return the error message, or throw if it unexpectedly succeeded. */
async function rejects(
  client: Client,
  sql: string,
  params: unknown[] = [],
): Promise<string> {
  try {
    await client.query(sql, params);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`expected statement to be rejected but it succeeded: ${sql}`);
}

/** Insert a claim about the agency, as the given subject/source-key pair. */
async function insertClaim(
  client: Client,
  options: {
    claimId: string;
    subjectId?: string;
    retrievalId?: string;
    sourceRecordKey?: string;
    status?: string;
    value?: string;
  },
): Promise<void> {
  await client.query(
    `insert into public.claim
       (claim_id, subject_type, subject_id, predicate, value_text,
        retrieval_id, source_record_key, confidence, confidence_basis,
        publication_status)
     values ($1, 'agency', $2, 'agency_name', $3, $4, $5, 1.0,
             'source_asserted', $6)`,
    [
      options.claimId,
      options.subjectId ?? AGENCY,
      options.value ?? "Example Police Department",
      options.retrievalId ?? RETRIEVAL,
      options.sourceRecordKey ?? SOURCE_RECORD_KEY,
      options.status ?? "published",
    ],
  );
}

/** Apply a suppression the way the corrections process would. */
async function suppress(
  suppressionId: string,
  subjectId: string,
  reasonCode = "takedown_request",
): Promise<void> {
  await admin.query(`select set_config('intake.actor', $1, false)`, [
    "founding-engineer",
  ]);
  await admin.query(
    `insert into public.subject_suppression
       (suppression_id, subject_type, subject_id, reason_code, reason_note,
        requested_by, applied_by)
     values ($1, 'agency', $2, $3, 'Applied pending Executive Director review.',
             'requester-of-record', 'founding-engineer')`,
    [suppressionId, subjectId, reasonCode],
  );
}

describe.skipIf(!DATABASE_URL)("corrections and takedown mechanics", () => {
  beforeAll(async () => {
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();

    // Start from a known-empty state so the suite is re-runnable.
    await admin.query(`drop schema if exists render cascade`);
    await admin.query(`drop schema if exists public cascade`);
    await admin.query(`create schema public`);
    for (const role of ["page_renderer", "intake_writer"]) {
      await admin.query(`drop owned by ${role}`).catch(() => {});
      await admin.query(`drop role if exists ${role}`).catch(() => {});
    }

    const agencyExists = await admin.query(
      `select to_regclass('public.agency') is not null as present`,
    );
    if (!agencyExists.rows[0].present) {
      await admin.query(readFileSync(FIXTURE_PATH, "utf8"));
    }

    await admin.query(readFileSync(PROVENANCE_MIGRATION, "utf8"));
    await admin.query(readFileSync(CORRECTIONS_MIGRATION, "utf8"));

    await admin.query(
      `insert into public.source
         (source_id, slug, name, publisher, access_basis, terms_status,
          terms_reviewed_at, terms_reviewed_by)
       values ($1, 'ins9-test-source', 'INS-9 Test Source', 'Test Publisher',
               'public_api', 'cleared', now(), 'founding-engineer')`,
      [SOURCE],
    );

    // Two retrievals of the same source: the first run and the re-run.
    for (const [id, when] of [
      [RETRIEVAL, "2026-08-20T00:00:00Z"],
      [RETRIEVAL_RERUN, "2026-08-24T00:00:00Z"],
    ]) {
      await admin.query(
        `insert into public.source_retrieval
           (retrieval_id, source_id, retrieved_at, source_url, content_hash)
         values ($1, $2, $3, 'https://example.gov/roster', 'hash-' || $1)`,
        [id, SOURCE, when],
      );
    }

    await admin.query(
      `insert into public.claim_predicate
         (predicate, subject_type, datatype, description)
       values ('agency_name', 'agency', 'text', 'Agency name as published by the source')`,
    );

    // Log in as the ingestion role to prove the privilege boundary, not just
    // the triggers. Rewrite the URL's credentials, keeping host and database.
    const loaderUrl = new URL(DATABASE_URL!);
    loaderUrl.username = "intake_writer";
    loaderUrl.password = "";
    await admin.query(`alter role intake_writer login`);
    loader = new Client({ connectionString: loaderUrl.toString() });
    await loader.connect();
  }, 60_000);

  afterAll(async () => {
    await loader?.end();
    await admin?.end();
  });

  /**
   * Every table this suite touches is append-only, undeletable, or guarded --
   * that is the whole point of the migration -- so resetting between tests
   * means turning the guards off, truncating, and turning them back on.
   *
   * `alter table ... disable trigger` requires table ownership, which no live
   * role holds: intake_writer and page_renderer both fail this statement. The
   * escape hatch exists for the test harness and is unreachable in production.
   */
  const GUARDS: ReadonlyArray<[table: string, trigger: string]> = [
    ["public.subject_suppression", "subject_suppression_no_delete"],
    ["public.claim", "claim_suppression_guard"],
    ["public.publication_event", "publication_event_append_only"],
    ["public.correction_request", "correction_request_no_delete"],
    ["public.agency", "agency_suppression_guard"],
  ];

  beforeEach(async () => {
    for (const [table, trigger] of GUARDS) {
      await admin.query(`alter table ${table} disable trigger ${trigger}`);
    }

    // publication_event first: its claim_id FK is `on delete set null`, so
    // deleting a claim UPDATEs the audit row, which the append-only trigger
    // rejects. An audited claim is effectively undeletable in production, and
    // that is the correct behaviour -- here it just means ordering matters.
    await admin.query(`delete from public.publication_event`);
    await admin.query(`delete from public.claim`);
    await admin.query(`delete from public.suppression_source_key`);
    await admin.query(`delete from public.subject_suppression`);
    await admin.query(`delete from public.correction_request`);

    for (const id of [AGENCY, AGENCY_REIDENTIFIED]) {
      await admin.query(`delete from public.agency where id = $1`, [id]);
      await admin.query(
        `insert into public.agency (id, name, state)
         values ($1, 'Example Police Department', 'TX')`,
        [id],
      );
    }

    for (const [table, trigger] of GUARDS) {
      await admin.query(`alter table ${table} enable trigger ${trigger}`);
    }
  });

  // -------------------------------------------------------------------------

  describe("a record can be suppressed", () => {
    it("removes the subject from the public render surface", async () => {
      await insertClaim(admin, { claimId: "clm_ins9_visible" });

      const before = await admin.query(
        `select 1 from render.published_claim where subject_id = $1`,
        [AGENCY],
      );
      expect(before.rowCount).toBe(1);

      await suppress(SUPPRESSION, AGENCY);

      const after = await admin.query(
        `select 1 from render.published_claim where subject_id = $1`,
        [AGENCY],
      );
      expect(after.rowCount).toBe(0);
    });

    it("captures the upstream record keys behind the subject", async () => {
      await insertClaim(admin, { claimId: "clm_ins9_keyed" });
      await suppress(SUPPRESSION, AGENCY);

      const keys = await admin.query(
        `select source_id, source_record_key
         from public.suppression_source_key where suppression_id = $1`,
        [SUPPRESSION],
      );
      expect(keys.rows).toEqual([
        { source_id: SOURCE, source_record_key: SOURCE_RECORD_KEY },
      ]);
    });

    it("reports no violations from the invariant self-check", async () => {
      await insertClaim(admin, { claimId: "clm_ins9_check" });
      await suppress(SUPPRESSION, AGENCY);

      const violations = await admin.query(
        `select * from public.assert_suppression_invariant()`,
      );
      expect(violations.rows).toEqual([]);

      const provenance = await admin.query(
        `select * from public.assert_provenance_invariant()`,
      );
      expect(provenance.rows).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------

  describe("suppression survives a full pipeline re-run", () => {
    beforeEach(async () => {
      await insertClaim(admin, { claimId: "clm_ins9_original" });
      await suppress(SUPPRESSION, AGENCY);
    });

    it("refuses a re-import of the same subject under the same canonical ID", async () => {
      const message = await rejects(
        loader,
        `insert into public.claim
           (claim_id, subject_type, subject_id, predicate, value_text,
            retrieval_id, source_record_key, confidence, confidence_basis,
            publication_status)
         values ('clm_ins9_rerun', 'agency', $1, 'agency_name',
                 'Example Police Department', $2, $3, 1.0,
                 'source_asserted', 'published')`,
        [AGENCY, RETRIEVAL_RERUN, SOURCE_RECORD_KEY],
      );

      expect(message).toContain("under active suppression");
      expect(message).toContain(SUPPRESSION);
    });

    it("refuses a re-import of the same upstream row under a NEW canonical ID", async () => {
      // The regenerated-ledger case. Every check keyed on the canonical ID
      // passes here -- AGENCY_REIDENTIFIED has no suppression row of its own.
      // Only the source-record-key guard catches this.
      expect(
        await admin.query(`select public.is_id_suppressed($1) as sup`, [
          AGENCY_REIDENTIFIED,
        ]),
      ).toMatchObject({ rows: [{ sup: null }] });

      const message = await rejects(
        loader,
        `insert into public.claim
           (claim_id, subject_type, subject_id, predicate, value_text,
            retrieval_id, source_record_key, confidence, confidence_basis,
            publication_status)
         values ('clm_ins9_reidentified', 'agency', $1, 'agency_name',
                 'Example Police Department', $2, $3, 1.0,
                 'source_asserted', 'published')`,
        [AGENCY_REIDENTIFIED, RETRIEVAL_RERUN, SOURCE_RECORD_KEY],
      );

      expect(message).toContain("under active suppression");
      expect(message).toContain(SUPPRESSION);
    });

    it("refuses an in-place update of the suppressed entity row", async () => {
      // The loader classifies an existing agency with owned columns as an
      // `update` and writes public.agency directly. Under a legal hold that
      // would overwrite the record we are holding.
      const message = await rejects(
        loader,
        `update public.agency set name = 'Renamed By Reimport' where id = $1`,
        [AGENCY],
      );
      expect(message).toContain("under active suppression");
    });

    it("refuses a delete-and-recreate of the suppressed entity row", async () => {
      const message = await rejects(
        loader,
        `delete from public.agency where id = $1`,
        [AGENCY],
      );
      expect(message).toContain("under active suppression");
    });

    it("denies the ingestion role any privilege to lift a suppression", async () => {
      // Belt and braces: the triggers above stop an accidental lift, this
      // stops a deliberate one and survives a future migration that drops a
      // trigger.
      const update = await rejects(
        loader,
        `update public.subject_suppression set lifted_at = now(),
           lifted_by = 'loader', lift_note = 'reimport' where suppression_id = $1`,
        [SUPPRESSION],
      );
      expect(update).toMatch(/permission denied/i);

      const remove = await rejects(
        loader,
        `delete from public.subject_suppression where suppression_id = $1`,
        [SUPPRESSION],
      );
      expect(remove).toMatch(/permission denied/i);

      const insert = await rejects(
        loader,
        `insert into public.suppression_source_key
           (suppression_id, source_id, source_record_key)
         values ($1, $2, 'forged')`,
        [SUPPRESSION, SOURCE],
      );
      expect(insert).toMatch(/permission denied/i);
    });

    it("lets the ingestion role READ suppression state so it can skip records", async () => {
      // Read access is required, not incidental: intake pre-filters suppressed
      // subjects so the guard above stays a backstop rather than the routine
      // failure path.
      const visible = await loader.query(
        `select public.is_source_key_suppressed($1, $2) as sup`,
        [SOURCE, SOURCE_RECORD_KEY],
      );
      expect(visible.rows[0].sup).toBe(SUPPRESSION);
    });

    it("keeps the subject off the render surface after the re-run attempt", async () => {
      await rejects(
        loader,
        `update public.agency set name = 'Renamed By Reimport' where id = $1`,
        [AGENCY],
      );

      const rendered = await admin.query(
        `select 1 from render.published_claim where subject_id = $1`,
        [AGENCY],
      );
      expect(rendered.rowCount).toBe(0);

      const violations = await admin.query(
        `select * from public.assert_suppression_invariant()`,
      );
      expect(violations.rows).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------

  describe("the action is logged", () => {
    it("writes an audit event naming the actor, reason, and basis", async () => {
      await insertClaim(admin, { claimId: "clm_ins9_logged" });
      await suppress(SUPPRESSION, AGENCY);

      const events = await admin.query(
        `select subject_type, subject_id, to_status, reason_code, reason_note, actor
         from public.publication_event
         where subject_id = $1 and claim_id is null`,
        [AGENCY],
      );

      expect(events.rows).toEqual([
        {
          subject_type: "agency",
          subject_id: AGENCY,
          to_status: "blocked",
          reason_code: "takedown_request",
          reason_note: "Applied pending Executive Director review.",
          actor: "founding-engineer",
        },
      ]);
    });

    it("refuses to delete a suppression, so the evidence cannot be erased", async () => {
      await suppress(SUPPRESSION, AGENCY);
      const message = await rejects(
        admin,
        `delete from public.subject_suppression where suppression_id = $1`,
        [SUPPRESSION],
      );
      expect(message).toContain("not deletable");
    });

    it("refuses to rewrite why or against whom a suppression was filed", async () => {
      await suppress(SUPPRESSION, AGENCY);
      const message = await rejects(
        admin,
        `update public.subject_suppression set reason_code = 'accuracy_dispute'
         where suppression_id = $1`,
        [SUPPRESSION],
      );
      expect(message).toContain("only the lift fields may be updated");
    });

    it("refuses to lift a suppression without stating the basis", async () => {
      await suppress(SUPPRESSION, AGENCY);
      const message = await rejects(
        admin,
        `update public.subject_suppression
         set lifted_at = now(), lifted_by = 'executive-director'
         where suppression_id = $1`,
        [SUPPRESSION],
      );
      expect(message).toContain("requires lift_note");
    });

    it("returns claims to staged on lift rather than republishing them", async () => {
      await insertClaim(admin, { claimId: "clm_ins9_lift" });
      await suppress(SUPPRESSION, AGENCY);

      await admin.query(`select set_config('intake.actor', $1, false)`, [
        "executive-director",
      ]);
      await admin.query(
        `update public.subject_suppression
         set lifted_at = now(), lifted_by = 'executive-director',
             lift_note = 'Dispute resolved; wrong subject suppressed.'
         where suppression_id = $1`,
        [SUPPRESSION],
      );

      const claim = await admin.query(
        `select publication_status from public.claim where claim_id = 'clm_ins9_lift'`,
      );
      expect(claim.rows[0].publication_status).toBe("staged");

      // Lifting must not put the page back up by itself.
      const rendered = await admin.query(
        `select 1 from render.published_claim where subject_id = $1`,
        [AGENCY],
      );
      expect(rendered.rowCount).toBe(0);

      const lift = await admin.query(
        `select to_status, actor, reason_note from public.publication_event
         where subject_id = $1 and claim_id is null and to_status = 'staged'`,
        [AGENCY],
      );
      expect(lift.rows[0]).toMatchObject({
        to_status: "staged",
        actor: "executive-director",
        reason_note: "Dispute resolved; wrong subject suppressed.",
      });
    });
  });

  // -------------------------------------------------------------------------

  describe("intake path", () => {
    async function fileRequest(requestId: string, kind: string): Promise<void> {
      await admin.query(
        `insert into public.correction_request
           (request_id, channel, request_kind, request_text,
            requester_name, requester_contact, subject_hint)
         values ($1, 'email', $2, 'The record about me is wrong.',
                 'A Requester', 'requester@example.com',
                 'https://policeconduct.org/agency/example')`,
        [requestId, kind],
      );
    }

    it("accepts a correction request and holds the requester's own words", async () => {
      await fileRequest("req_ins9_correction", "correction");
      const row = await admin.query(
        `select request_text, disposition from public.correction_request
         where request_id = 'req_ins9_correction'`,
      );
      expect(row.rows[0]).toEqual({
        request_text: "The record about me is wrong.",
        disposition: "received",
      });
    });

    it("refuses to edit the substance of a request after intake", async () => {
      await fileRequest("req_ins9_immutable", "correction");
      const message = await rejects(
        admin,
        `update public.correction_request set request_text = 'paraphrased'
         where request_id = 'req_ins9_immutable'`,
      );
      expect(message).toContain("immutable after intake");
    });

    it("refuses to resolve a legal demand that was not escalated", async () => {
      await fileRequest("req_ins9_legal", "legal_demand");
      const message = await rejects(
        admin,
        `update public.correction_request
         set disposition = 'action_taken', decided_at = now(), decided_by = 'founding-engineer'
         where request_id = 'req_ins9_legal'`,
      );
      expect(message).toContain("Executive Director");
    });

    it("allows a legal demand to be escalated, which is where it stops", async () => {
      await fileRequest("req_ins9_legal_ok", "legal_demand");
      await admin.query(
        `update public.correction_request
         set disposition = 'escalated', escalated_at = now(),
             escalated_to = 'executive-director'
         where request_id = 'req_ins9_legal_ok'`,
      );
      const row = await admin.query(
        `select disposition from public.correction_request
         where request_id = 'req_ins9_legal_ok'`,
      );
      expect(row.rows[0].disposition).toBe("escalated");
    });

    it("refuses to decline a suspected sealed or expunged record", async () => {
      await fileRequest("req_ins9_sealed", "sealed_or_expunged");
      const message = await rejects(
        admin,
        `update public.correction_request
         set disposition = 'declined', escalated_at = now(),
             escalated_to = 'executive-director',
             decided_at = now(), decided_by = 'executive-director'
         where request_id = 'req_ins9_sealed'`,
      );
      expect(message).toContain("cannot be declined");
    });

    it("refuses to close a request without naming who decided", async () => {
      await fileRequest("req_ins9_unattributed", "correction");
      const message = await rejects(
        admin,
        `update public.correction_request set disposition = 'declined'
         where request_id = 'req_ins9_unattributed'`,
      );
      expect(message).toMatch(/correction_request_resolution_attributed/);
    });

    it("refuses to delete a request", async () => {
      await fileRequest("req_ins9_undeletable", "correction");
      const message = await rejects(
        admin,
        `delete from public.correction_request where request_id = 'req_ins9_undeletable'`,
      );
      expect(message).toContain("not deletable");
    });
  });

  // -------------------------------------------------------------------------

  describe("public corrections log", () => {
    it("names the agency when an agency record is withheld", async () => {
      await insertClaim(admin, { claimId: "clm_ins9_log_agency" });
      await suppress(SUPPRESSION, AGENCY, "accuracy_dispute");

      const log = await admin.query(
        `select subject_type, subject_id, action, reason
         from render.corrections_log`,
      );
      expect(log.rows).toEqual([
        {
          subject_type: "agency",
          subject_id: AGENCY,
          action: "Record withheld",
          reason: "Accuracy dispute",
        },
      ]);
    });

    it("withholds the subject ID when the record concerns a person", async () => {
      // Naming the person whose record was removed republishes the association
      // the removal was meant to end -- on a page built to be crawled.
      await admin.query(`select set_config('intake.actor', 'ed', false)`);
      await admin.query(
        `insert into public.subject_suppression
           (suppression_id, subject_type, subject_id, reason_code, applied_by)
         values ('sup_ins9_person', 'person', 'person_ins9_0001',
                 'data_subject_request', 'executive-director')`,
      );

      const log = await admin.query(
        `select subject_type, subject_id, action, reason
         from render.corrections_log`,
      );
      expect(log.rows).toEqual([
        {
          subject_type: "person",
          subject_id: null,
          action: "Record withheld",
          reason: "Request from the person named",
        },
      ]);
    });

    it("exposes no requester identity to the page role", async () => {
      const columns = await admin.query(
        `select column_name from information_schema.columns
         where table_schema = 'render' and table_name = 'corrections_log'`,
      );
      const names = columns.rows.map((row) => row.column_name);
      expect(names).not.toContain("requester_name");
      expect(names).not.toContain("requester_contact");
      expect(names).not.toContain("request_text");
    });

    it("does not grant the page role access to the request table", async () => {
      const granted = await admin.query(
        `select 1 from information_schema.table_privileges
         where grantee = 'page_renderer' and table_name = 'correction_request'`,
      );
      expect(granted.rowCount).toBe(0);
    });
  });
});
