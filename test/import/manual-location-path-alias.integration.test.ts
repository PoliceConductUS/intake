import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { acquire } from "../../sources/org.policeconduct.manual/acquire.js";
import { transform } from "../../sources/org.policeconduct.manual/transform.js";
import { buildArtifactsEnvelope } from "../../src/cli/transform/source-transform.js";
import { importArtifacts } from "../../src/cli/import/artifacts/config.js";
import { Artifacts } from "../../src/shared/io/Artifacts.js";
import {
  dockerAvailable,
  startIntakeDatabase,
  type IntakeDatabase,
} from "../cli/database/intake-postgres.js";

const NAMESPACE = "org.policeconduct.manual";

// The place the curated alias points at. The operator supplies its PATH as the
// reference "source id" (LocationPath is not ledger-mapped, ADR 0031/0023); the
// stored FK is the row's location_path_id, resolved by that path.
const TARGET_PATH = "/mn/ramsey-county/saint-paul/";
const TARGET_LOCATION_PATH_ID = "saint-paul-location-path-id";
const ALIAS_PATH = "/mn/ramsey-county/st-paul/";

const describeWithDocker = dockerAvailable() ? describe : describe.skip;

describeWithDocker(
  "manual LocationPathAlias imports against real Postgres",
  () => {
    let db: IntakeDatabase;

    beforeAll(async () => {
      db = await startIntakeDatabase();
    }, 180_000);

    afterAll(async () => {
      await db?.stop();
    });

    beforeEach(async () => {
      await db.truncateAll();
      // The target location_path exists from a PRIOR source's import; the manual
      // source emits ONLY the alias, so its FK must resolve cross-run against the DB.
      await db.query(
        `insert into public.location_path (location_path_id, path, level, display_name)
       values ($1, $2, 'place', 'Minnesota')`,
        [TARGET_LOCATION_PATH_ID, TARGET_PATH],
      );
    });

    test("resolves location_path_id by path and lands the alias row", async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), "manual-alias-"));
      const state = await mkdtemp(path.join(tmpdir(), "manual-state-"));

      // Drive the manual source: interview (env-driven) -> chain, then emit.
      await acquire({
        sourceDir: await mkdtemp(path.join(tmpdir(), "manual-src-")),
        state,
        env: {
          MANUAL_KIND: "LocationPathAlias",
          MANUAL_RECORD: JSON.stringify({
            alias_path: ALIAS_PATH,
            // The reference "source id" for a LocationPath is its PATH, not the PK.
            location_path_id: TARGET_PATH,
          }),
        },
        data: {} as never,
      });
      const manifest = await transform({
        paths: [],
        readXlsx: async () => [],
        state,
        emit: async () => {},
      } as never);

      const envelope = buildArtifactsEnvelope(NAMESPACE, "digest", manifest);
      const writtenArtifacts = await Artifacts.write(rootDir, envelope);

      const runId = "tz4a98xxat96iws9zmbrgj3a";
      const result = await importArtifacts({
        artifactsPath: writtenArtifacts.path,
        env: {
          DATABASE_URL: db.connectionString,
          INTAKE_WORKSPACE_TEST: rootDir,
        },
        logger: { info: () => {}, debug: () => {} },
        commandName: runId,
        commandDirectory: path.join(
          rootDir,
          "intake",
          "commands",
          `2026-08-26T00-00-00-000Z-${runId}`,
        ),
      });

      expect(result).toMatchObject({ ok: true });

      // The alias landed keyed by its natural key, with the FK resolved to the
      // target row's canonical location_path_id (the PK), not the typed path.
      expect(
        (
          await db.query(
            "select alias_path, location_path_id from public.location_path_alias",
          )
        ).rows,
      ).toEqual([
        {
          alias_path: ALIAS_PATH,
          location_path_id: TARGET_LOCATION_PATH_ID,
        },
      ]);
    });

    test("fails loud when the referenced path resolves to no location_path", async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), "manual-alias-"));
      const state = await mkdtemp(path.join(tmpdir(), "manual-state-"));

      await acquire({
        sourceDir: await mkdtemp(path.join(tmpdir(), "manual-src-")),
        state,
        env: {
          MANUAL_KIND: "LocationPathAlias",
          MANUAL_RECORD: JSON.stringify({
            alias_path: ALIAS_PATH,
            location_path_id: "/mn/nowhere-county/atlantis/",
          }),
        },
        data: {} as never,
      });
      const manifest = await transform({
        paths: [],
        readXlsx: async () => [],
        state,
        emit: async () => {},
      } as never);

      const envelope = buildArtifactsEnvelope(NAMESPACE, "digest", manifest);
      const writtenArtifacts = await Artifacts.write(rootDir, envelope);

      const runId = "tz4a98xxat96iws9zmbrgj3b";
      const result = await importArtifacts({
        artifactsPath: writtenArtifacts.path,
        env: {
          DATABASE_URL: db.connectionString,
          INTAKE_WORKSPACE_TEST: rootDir,
        },
        logger: { info: () => {}, debug: () => {} },
        commandName: runId,
        commandDirectory: path.join(
          rootDir,
          "intake",
          "commands",
          `2026-08-26T00-00-00-000Z-${runId}`,
        ),
      });

      expect(result).toMatchObject({
        ok: false,
        error: expect.stringContaining(
          'references LocationPath "/mn/nowhere-county/atlantis/"',
        ),
      });
      // Nothing landed: resolve-or-fail aborted before any write.
      expect(
        (
          await db.query(
            "select count(*)::int as n from public.location_path_alias",
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
    });
  },
);
