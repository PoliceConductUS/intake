import { mkdtemp, rm } from "node:fs/promises";
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
import { importArtifacts } from "../../src/cli/import/artifacts/config.js";
import { DatabaseMutations } from "../../src/cli/import/artifacts/io/DatabaseMutations.js";
import { replayDatabaseMutations } from "../../src/cli/replay/database-mutations/config.js";
import {
  readResolvedProperty,
  writeResolvedProperty,
  type ResolvedPropertyCacheInput,
} from "../../src/cli/state/resolved-property/index.js";
import { persistSourceNameToCanonicalIds } from "../../src/cli/state/source-name-to-canonical-id/index.js";
import { Artifacts } from "../../src/shared/io/Artifacts.js";
import { INTAKE_API_VERSION } from "../../src/shared/io/import-types.js";
import {
  dockerAvailable,
  startIntakeDatabase,
  type IntakeDatabase,
} from "../cli/database/intake-postgres.js";

const namespace = "slug-regression";
const personId = "preserved-personnel-id";
const agencyId = "preserved-agency-id";
const locationId = "preserved-place-id";
const describeWithDocker = dockerAvailable() ? describe : describe.skip;

describeWithDocker(
  "canonical slug preservation against the current migrated PostgreSQL schema",
  () => {
    let db: IntakeDatabase;
    let rootDir: string;
    const workspaces: string[] = [];

    beforeAll(async () => {
      db = await startIntakeDatabase();
    }, 180_000);
    afterAll(async () => {
      await db?.stop();
      await Promise.all(
        workspaces.map((dir) => rm(dir, { recursive: true, force: true })),
      );
    });
    beforeEach(async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), "intake-slug-regression-"));
      workspaces.push(rootDir);
      await db.truncateAll();
      await db.query(
        "insert into public.location_path (location_path_id, path, level, display_name) values ($1, '/mn/saint-paul/', 'place', 'Saint Paul')",
        [locationId],
      );
      await db.query(
        "insert into public.personnel (id, first_name, last_name, slug) values ($1, 'Original', 'Person', 'published-person')",
        [personId],
      );
      await db.query(
        "insert into public.agency (id, name, city, state, address, zip_code, slug, location_path_id, latitude, longitude) values ($1, 'Original Agency', 'Saint Paul', 'MN', '444 Cedar Street', '55101', 'published-agency', $2, 44.955097, -93.102211)",
        [agencyId, locationId],
      );
      await persistSourceNameToCanonicalIds(
        namespace,
        {
          locationPaths: {},
          agencies: {
            "source-agency": { kind: "Agency", canonicalId: agencyId },
          },
          personnel: {
            "source-person": { kind: "Personnel", canonicalId: personId },
          },
          agencyPersonnel: {},
        },
        { rootDir },
      );
    });

    function cacheInput(
      kind: string,
      id: string,
    ): ResolvedPropertyCacheInput & { rootDir: string } {
      return {
        rootDir,
        subject: { apiVersion: INTAKE_API_VERSION, kind, name: id },
        targetProperty: "slug",
      };
    }

    async function load(run: string, includeSourceSlug: boolean) {
      const artifacts = await Artifacts.write(
        path.join(rootDir, run),
        Artifacts.new({
          metadata: { namespace, name: run },
          spec: {
            artifacts: [
              {
                kind: "Personnel",
                spec: {
                  records: {
                    "source-person": {
                      spec: {
                        first_name: "Corrected",
                        last_name: "Person",
                        ...(includeSourceSlug
                          ? { slug: "producer-person" }
                          : {}),
                      },
                    },
                  },
                },
              },
              {
                kind: "Agencies",
                spec: {
                  records: {
                    "source-agency": {
                      spec: {
                        name: "Corrected Agency",
                        city: "Saint Paul",
                        state: "MN",
                        address: "444 Cedar Street",
                        zip_code: "55101",
                        location_path_id: locationId,
                        latitude: 44.955097,
                        longitude: -93.102211,
                        ...(includeSourceSlug
                          ? { slug: "producer-agency" }
                          : {}),
                      },
                    },
                  },
                },
              },
            ],
          },
        }),
      );
      return importArtifacts({
        artifactsPath: artifacts.path,
        env: {
          DATABASE_URL: db.connectionString,
          INTAKE_WORKSPACE_TEST: rootDir,
        },
        commandName: run,
        commandDirectory: path.join(rootDir, "intake", "commands", run),
        logger: { info: () => {}, debug: () => {} },
      });
    }

    async function expectPublishedIdentities() {
      expect(
        (await db.query("select id, slug from public.personnel")).rows,
      ).toEqual([{ id: personId, slug: "published-person" }]);
      expect(
        (await db.query("select id, slug from public.agency")).rows,
      ).toEqual([{ id: agencyId, slug: "published-agency" }]);
    }

    test.each([false, true])(
      "re-import preserves IDs and URLs while applying name corrections (source slug: %s)",
      async (sourceSlug) => {
        expect(await load("correct-names", sourceSlug)).toMatchObject({
          ok: true,
        });
        await expectPublishedIdentities();
        expect(
          (await db.query("select first_name from public.personnel")).rows,
        ).toEqual([{ first_name: "Corrected" }]);
        expect((await db.query("select name from public.agency")).rows).toEqual(
          [{ name: "Corrected Agency" }],
        );
        expect(
          await readResolvedProperty(cacheInput("Personnel", personId)),
        ).toBe("published-person");
        expect(await readResolvedProperty(cacheInput("Agency", agencyId))).toBe(
          "published-agency",
        );
      },
    );

    test("a database reload reuses canonical IDs and cached URLs despite new source slugs", async () => {
      expect(await load("cache-established-slugs", false)).toMatchObject({
        ok: true,
      });
      await db.query("delete from public.agency where id = $1", [agencyId]);
      await db.query("delete from public.personnel where id = $1", [personId]);
      expect(await load("reload", true)).toMatchObject({ ok: true });
      await expectPublishedIdentities();
    });

    test("a conflicting canonical cache fails visibly without changing database rows", async () => {
      await writeResolvedProperty({
        ...cacheInput("Personnel", personId),
        value: "conflicting-cache-slug",
        source: { namespace, kind: "Personnel", name: "source-person" },
      });
      const result = await load("conflicting-cache", true);
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) expect(result.error).toMatch(/slug/i);
      await expectPublishedIdentities();
      expect(
        (await db.query("select first_name from public.personnel")).rows,
      ).toEqual([{ first_name: "Original" }]);
      expect(
        await readResolvedProperty(cacheInput("Personnel", personId)),
      ).toBe("conflicting-cache-slug");
    });

    test.each([false, true])(
      "a new agency cannot take an absent cached agency's URL (reload old in same import: %s)",
      async (includeOld) => {
        await writeResolvedProperty({
          ...cacheInput("Agency", agencyId),
          value: "published-agency",
        });
        await db.query("delete from public.agency where id = $1", [agencyId]);
        await persistSourceNameToCanonicalIds(
          namespace,
          {
            locationPaths: {},
            personnel: {},
            agencyPersonnel: {},
            agencies: {
              "new-source-agency": {
                kind: "Agency",
                canonicalId: "new-agency-id",
              },
            },
          },
          { rootDir },
        );
        const spec = (name: string) => ({
          name,
          city: "Saint Paul",
          state: "MN",
          address: "444 Cedar Street",
          zip_code: "55101",
          location_path_id: locationId,
          latitude: 44.955097,
          longitude: -93.102211,
        });
        const records: Record<string, { spec: ReturnType<typeof spec> }> = {
          "new-source-agency": { spec: spec("Published Agency") },
        };
        if (includeOld)
          records["source-agency"] = { spec: spec("Corrected Agency") };
        const artifacts = await Artifacts.write(
          path.join(rootDir, "new-before-old"),
          Artifacts.new({
            metadata: { namespace, name: "new-before-old" },
            spec: { artifacts: [{ kind: "Agencies", spec: { records } }] },
          }),
        );
        const result = await importArtifacts({
          artifactsPath: artifacts.path,
          env: {
            DATABASE_URL: db.connectionString,
            INTAKE_WORKSPACE_TEST: rootDir,
          },
          commandName: "new-before-old",
          commandDirectory: path.join(
            rootDir,
            "intake",
            "commands",
            "new-before-old",
          ),
          logger: { info: () => {}, debug: () => {} },
        });
        expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
        expect(
          (
            await db.query(
              "select slug from public.agency where id = 'new-agency-id'",
            )
          ).rows,
        ).toEqual([{ slug: "published-agency-2" }]);
        expect(await readResolvedProperty(cacheInput("Agency", agencyId))).toBe(
          "published-agency",
        );
        expect(
          await readResolvedProperty(cacheInput("Agency", "new-agency-id")),
        ).toBe("published-agency-2");
        expect(await load("reload-original", false)).toMatchObject({
          ok: true,
        });
        expect(
          (
            await db.query("select slug from public.agency where id = $1", [
              agencyId,
            ])
          ).rows,
        ).toEqual([{ slug: "published-agency" }]);
      },
    );

    test.each([
      ["Personnel", personId, "slug", "published-person", "changed-person"],
      ["Agency", agencyId, "slug", "published-agency", "changed-agency"],
      ["LocationPath", locationId, "path", "/mn/saint-paul/", "/mn/changed/"],
      ["Personnel", personId, "id", personId, "changed-id"],
    ])(
      "replay rejects changing %s.%s %s and rolls back earlier writes",
      async (kind, id, field, from, to) => {
        const source = {
          namespace,
          command: { name: "replay" },
          kind,
          name: id,
        };
        const mutations = await DatabaseMutations.write(
          rootDir,
          DatabaseMutations.new({
            metadata: { namespace, name: "invalid-url-update" },
            spec: {
              mutations: [
                {
                  kind: "PersonnelUpdate",
                  name: personId,
                  spec: {
                    operations: [
                      {
                        action: "set",
                        path: "first_name",
                        from: "Original",
                        to: "Should Roll Back",
                        reason: "Test atomic rollback.",
                        source,
                      },
                    ],
                  },
                },
                {
                  kind: `${kind}Update`,
                  name: id,
                  spec: {
                    operations: [
                      {
                        action: "set",
                        path: field,
                        from,
                        to,
                        reason: "Attempt identity change.",
                        source,
                      },
                    ],
                  },
                },
              ],
            },
          }),
        );
        const result = await replayDatabaseMutations({
          databaseMutationsPath: mutations.path,
          env: { DATABASE_URL: db.connectionString },
        });
        expect(result).toMatchObject({ ok: false });
        if (!result.ok)
          expect(result.error).toMatch(/preserv|immutable|cannot change/i);
        await expectPublishedIdentities();
        expect(
          (await db.query("select first_name from public.personnel")).rows,
        ).toEqual([{ first_name: "Original" }]);
        expect(
          (
            await db.query(
              "select location_path_id, path from public.location_path",
            )
          ).rows,
        ).toEqual([{ location_path_id: locationId, path: "/mn/saint-paul/" }]);
      },
    );
  },
);
