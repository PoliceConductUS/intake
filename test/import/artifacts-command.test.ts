import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runImportArtifactsCommand } from "../../src/cli/index.js";
import {
  planDatabaseMutations,
  type DatabaseClient,
} from "../../src/cli/import/artifacts/plan-database-mutations.js";
import { importArtifacts } from "../../src/cli/import/artifacts/config.js";
import { DataContext } from "../../src/cli/import/artifacts/data-context.js";
import { applyOptionalArtifactMutation } from "../../src/cli/import/artifacts/artifact-mutation.js";
import { ArtifactMutation } from "../../src/cli/import/artifacts/io/ArtifactMutation.js";
import { ArtifactMutations } from "../../src/cli/import/artifacts/io/ArtifactMutations.js";
import { type ImportOperations } from "../../src/cli/import/artifacts/operations.js";
import { DatabaseMutations } from "../../src/cli/import/artifacts/io/DatabaseMutations.js";
import { DatabaseMutationsDebug } from "../../src/cli/import/artifacts/io/DatabaseMutationsDebug.js";
import { replayDatabaseMutations } from "../../src/cli/replay/database-mutations/config.js";
import { persistSourceNameToCanonicalIds } from "../../src/cli/state/source-name-to-canonical-id/index.js";
import {
  readResolvedProperty,
  type ResolvedPropertyCacheInput,
} from "../../src/cli/state/resolved-property/index.js";
import { Artifacts } from "../../src/shared/io/Artifacts.js";
import { Command as CommandEnvelope } from "../../src/shared/io/Command.js";
import { write as writeAgencies } from "../../src/shared/io/generated/Agencies.js";
import { AgencyCreate } from "../../src/cli/import/artifacts/io/generated-mutations/AgencyCreate.js";
import { LocationPathCreate } from "../../src/cli/import/artifacts/io/generated-mutations/LocationPathCreate.js";
import { LocationPathGeometryCreate } from "../../src/cli/import/artifacts/io/generated-mutations/LocationPathGeometryCreate.js";
import { INTAKE_API_VERSION } from "../../src/shared/io/import-types.js";
import { yamlResourceFileName } from "../../src/shared/io/resource.js";
import type {
  ImportRows,
  LocationPathGeometryRow,
  LocationPathRow,
} from "../../src/cli/import/artifacts/transform.js";

const rows: ImportRows = {
  locationPaths: [],
  locationPathAliases: [],
  agencies: [
    {
      id: "agency-canonical-id",
      name: "Minnesota State Patrol",
      city: "Saint Paul",
      state: "MN",
      address: "444 Cedar Street",
      zip_code: "55101",
      contact_name: null,
      contact_email: null,
      slug: "minnesota-state-patrol",
      location_path_id: "mn/saint-paul/minnesota-state-patrol",
      latitude: 44.955097,
      longitude: -93.102211,
    },
  ],
  agencyOfficers: [
    {
      id: "agency-personnel-canonical-id",
      agency_id: "agency-canonical-id",
      personnel_id: "personnel-canonical-id",
      badge_number: "49112",
      start_date: "2020-01-01",
      end_date: null,
      title: "Peace Officer",
      license_id: null,
    },
  ],
  preparationMutations: [],
  ownedColumns: {
    agencies: {
      "agency-canonical-id": [
        "name",
        "city",
        "state",
        "address",
        "zip_code",
        "contact_name",
        "contact_email",
        "slug",
        "location_path_id",
        "latitude",
        "longitude",
      ],
    },
    agencyOfficers: {
      "agency-personnel-canonical-id": [
        "agency_id",
        "personnel_id",
        "badge_number",
        "start_date",
        "end_date",
        "title",
      ],
    },
  },
};

const createOperations: ImportOperations = {
  locationPaths: {},
  locationPathGeometries: {},
  locationPathAliases: {},
  agencies: {},
  officers: {},
  agencyOfficers: {},
  licensingAuthorities: {},
  licenses: {},
  licenseActions: {},
};

function locationPathSnapshot(
  placeLocationPathId = "mn/saint-paul/minnesota-state-patrol",
): LocationPathRow[] {
  return [
    {
      location_path_id: "mn-state-location-path-id",
      path: "/mn/",
      level: "state",
      state_or_territory_slug: "mn",
      administrative_area_slug: null,
      place_slug: null,
      state_or_territory_name: "Minnesota",
      administrative_area_name: null,
      place_name: null,
      parent_location_path_id: null,
    },
    {
      location_path_id: "ramsey-county-location-path-id",
      path: "/mn/ramsey-county/",
      level: "administrative_area",
      state_or_territory_slug: "mn",
      administrative_area_slug: "ramsey-county",
      place_slug: null,
      state_or_territory_name: "Minnesota",
      administrative_area_name: "Ramsey County",
      place_name: null,
      parent_location_path_id: "mn-state-location-path-id",
    },
    {
      location_path_id: placeLocationPathId,
      path: "/mn/ramsey-county/saint-paul/",
      level: "place",
      state_or_territory_slug: "mn",
      administrative_area_slug: "ramsey-county",
      place_slug: "saint-paul",
      state_or_territory_name: "Minnesota",
      administrative_area_name: "Ramsey County",
      place_name: "Saint Paul",
      parent_location_path_id: "ramsey-county-location-path-id",
    },
  ];
}

function locationPathGeometry(locationPathId: string): LocationPathGeometryRow {
  return {
    location_path_id: locationPathId,
    sourceLocationPathKey: `source:${locationPathId}`,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-93.2, 44.9],
          [-93.0, 44.9],
          [-93.0, 45.0],
          [-93.2, 45.0],
          [-93.2, 44.9],
        ],
      ],
    },
  };
}

const schemaRowsByTable: Record<string, Record<string, unknown>[]> = {
  agency: [
    { column_name: "id", is_nullable: "NO", column_default: "generate_cuid()" },
    { column_name: "name", is_nullable: "NO", column_default: null },
    { column_name: "state", is_nullable: "NO", column_default: null },
    { column_name: "slug", is_nullable: "NO", column_default: null },
    {
      column_name: "location_path_id",
      is_nullable: "NO",
      column_default: null,
    },
    { column_name: "latitude", is_nullable: "NO", column_default: null },
    { column_name: "longitude", is_nullable: "NO", column_default: null },
  ],
  officers: [
    { column_name: "id", is_nullable: "NO", column_default: "generate_cuid()" },
    { column_name: "first_name", is_nullable: "NO", column_default: null },
    { column_name: "last_name", is_nullable: "NO", column_default: null },
    { column_name: "slug", is_nullable: "NO", column_default: null },
  ],
  agency_officers: [
    { column_name: "id", is_nullable: "NO", column_default: "generate_cuid()" },
    { column_name: "officer_id", is_nullable: "NO", column_default: null },
    { column_name: "start_date", is_nullable: "NO", column_default: null },
  ],
};

class RecordingClient implements DatabaseClient {
  readonly queries: { text: string; values: readonly unknown[] }[] = [];
  ended = false;

  constructor(
    private readonly connectError?: Error,
    private readonly queryFailure?: { pattern: RegExp; error: Error },
    private readonly queryResponses: {
      pattern: RegExp;
      values?: readonly unknown[];
      rows: Record<string, unknown>[];
    }[] = [],
  ) {}

  async connect(): Promise<void> {
    if (this.connectError) {
      throw this.connectError;
    }
  }

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push({ text, values });

    if (this.queryFailure?.pattern.test(text)) {
      throw this.queryFailure.error;
    }

    if (/from information_schema\.columns\b/i.test(text)) {
      const tableName = typeof values[1] === "string" ? values[1] : "";
      return { rows: schemaRowsByTable[tableName] ?? [] };
    }

    if (/from supabase_migrations\.schema_migrations\b/i.test(text)) {
      return {
        rows: [
          {
            version: "20260608172000",
            name: "add_location_path_alias",
          },
        ],
      };
    }

    const isGeometryContainmentQuery =
      /join public\.location_path_geometry\b/i.test(text);
    const response = this.queryResponses.find(
      ({ pattern, values: expected }) =>
        pattern.test(text) &&
        (!isGeometryContainmentQuery ||
          pattern.source.includes("location_path_geometry")) &&
        (expected === undefined ||
          JSON.stringify(expected) === JSON.stringify(values)),
    );
    if (response) {
      return { rows: response.rows };
    }

    if (isGeometryContainmentQuery) {
      return { rows: [] };
    }

    if (/from public\.location_path\b/i.test(text) && values.length === 0) {
      return {
        rows: locationPathSnapshot(),
      };
    }

    if (
      /from public\.location_path\s+where location_path_id = \$1/i.test(text)
    ) {
      return {
        rows:
          typeof values[0] === "string"
            ? [
                {
                  location_path_id: values[0],
                  path: `/test/${values[0]}/`,
                  level: "place",
                  state_or_territory_slug: "test",
                  administrative_area_slug: "test-county",
                  place_slug: String(values[0]),
                  state_or_territory_name: "Test",
                  administrative_area_name: "Test County",
                  place_name: String(values[0]),
                  parent_location_path_id: "test-county-location-path-id",
                },
              ]
            : [],
      };
    }

    return { rows: [] };
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

async function writeSourceArtifactsFile(rootDir: string): Promise<string> {
  const writtenArtifacts = await Artifacts.write(
    rootDir,
    Artifacts.new({
      metadata: { name: "test-run", namespace: "mn-post" },
      spec: { artifacts: [] },
    }),
  );
  return writtenArtifacts.path;
}

describe("importArtifacts", () => {
  test("import-artifacts replay does not add source-resolved location path commands", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-debug-chain-"));
    const writtenArtifacts = await Artifacts.write(
      rootDir,
      Artifacts.new({
        metadata: { name: "test-run", namespace: "mn-post" },
        spec: {
          artifacts: [
            {
              kind: "Agencies",
              spec: {
                records: {
                  "agency-source-id": {
                    spec: {
                      name: "Minnesota State Patrol",
                      state: "MN",
                    },
                  },
                },
              },
            },
          ],
        },
      }),
    );
    const artifactsPath = writtenArtifacts.path;
    const artifacts = await Artifacts.read(artifactsPath);
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      locationPathGeometries: [
        locationPathGeometry("saint-paul-location-path-id"),
      ],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          location_path_id: undefined,
          latitude: undefined,
          longitude: undefined,
        },
      ],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": [
            "name",
            "city",
            "state",
            "location_path_id",
            "latitude",
            "longitude",
          ],
        },
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern:
          /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
        rows: locationPathSnapshot("saint-paul-location-path-id").filter(
          (locationPath) => locationPath.level === "place",
        ),
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: locationPathSnapshot("saint-paul-location-path-id"),
      },
    ]);

    const result = await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
      resolveAgencyCoordinates: async () => [
        {
          rowId: "agency-canonical-id",
          latitude: 44.955097,
          longitude: -93.102211,
        },
      ],
      resolveLocationAdministrativeArea: async () => ({
        administrativeAreaName: "Ramsey County",
      }),
    });
    const commandDirectory = path.join(
      rootDir,
      "intake",
      "commands",
      "2026-06-08T00-00-00-000Z-test-command",
    );
    // Agencies are facade-based (ADR 0016): register them from the artifacts so
    // the AgencyFacade emits (resolve-if-present from the planning-pass-resolved
    // row).
    const debugContext = new DataContext({
      rows: partialRows,
      operations: result.operations,
      sourceNameToCanonicalIds: {
        agencies: {
          "agency-source-id": { canonicalId: "agency-canonical-id" },
        },
        personnel: {},
        agencyPersonnel: {},
        locationPaths: {},
      },
    });
    debugContext.mergeAgencyArtifacts(artifacts);
    const databaseMutations = await debugContext.toDatabaseMutations({
      namespace: artifacts.metadata.namespace,
      name: "test-command",
      sourceArtifactsName: artifacts.metadata.name,
      sourceArtifactsPath: artifactsPath,
      sourceArtifactsDigest: await Artifacts.digest(artifactsPath),
      databaseSchema: result.schema,
    });
    const replayImportArtifactsEnvelope = await DatabaseMutations.write(
      commandDirectory,
      databaseMutations,
    );

    const importArtifactsEnvelope = await DatabaseMutations.read(
      replayImportArtifactsEnvelope.path,
    );
    const mutations = importArtifactsEnvelope.spec.mutations;

    expect(mutations.map((mutation) => mutation.kind)).toEqual([
      "LocationPathGeometryCreate",
      "AgencyCreate",
    ]);
    expect(mutations.map((mutation) => mutation.kind)).not.toContain(
      "LocationPathCreate",
    );
    expect(
      (mutations[1]?.spec as Record<string, unknown>).location_path_id,
    ).toEqual("saint-paul-location-path-id");
    expect(importArtifactsEnvelope.metadata.databaseSchema).toEqual({
      appliedMigrations: [
        {
          version: "20260608172000",
          name: "add_location_path_alias",
        },
      ],
    });
  });

  test("applies optional artifact mutation before transform", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-mutation-"));
    const sourceCommandDirectory = path.join(rootDir, "source-command");
    await mkdir(sourceCommandDirectory, { recursive: true });
    const mutationRefPath = path.join(
      sourceCommandDirectory,
      "mutations",
      yamlResourceFileName(
        "mn-post:test-run:Agency:agency-source-id:coordinates",
        "ArtifactMutation",
      ),
    );
    await mkdir(path.dirname(mutationRefPath), { recursive: true });
    await ArtifactMutation.write(
      path.dirname(mutationRefPath),
      ArtifactMutation.new({
        metadata: {
          name: "mn-post:test-run:Agency:agency-source-id:coordinates",
          namespace: "manual",
        },
        spec: {
          target: {
            namespace: "mn-post",
            command: { name: "test-run" },
            kind: "Agency",
            name: "agency-source-id",
          },
          operations: [
            {
              action: "set",
              path: "latitude",
              value: 46.3433,
              reason: "Manual address point from agency website.",
              source: {
                namespace: "mn-post",
                command: { name: "test-run" },
                kind: "Agencies",
                name: "agency-source-id",
              },
            },
            {
              action: "set",
              path: "longitude",
              value: -94.2821,
              reason: "Manual address point from agency website.",
              source: {
                namespace: "mn-post",
                command: { name: "test-run" },
                kind: "Agencies",
                name: "agency-source-id",
              },
            },
          ],
        },
      }),
    );
    await ArtifactMutations.write(
      sourceCommandDirectory,
      ArtifactMutations.new({
        metadata: {
          name: "test-run",
          namespace: "manual",
          annotations: { "policeconduct.org/intake.createdBy": "manual" },
        },
        spec: {
          mutations: [
            {
              target: {
                namespace: "mn-post",
                command: { name: "test-run" },
                kind: "Agency",
                name: "agency-source-id",
              },
              operations: [
                {
                  action: "set",
                  path: "urls.website",
                  value: "https://example.test/police",
                  reason: "Manual agency website enrichment.",
                  source: {
                    namespace: "mn-post",
                    command: { name: "test-run" },
                    kind: "Agencies",
                    name: "agency-source-id",
                  },
                },
              ],
            },
            {
              ref: {
                path: `mutations/${path.basename(mutationRefPath)}`,
                kind: "ArtifactMutation",
              },
            },
          ],
        },
      }),
    );
    await writeAgencies(
      sourceCommandDirectory,
      {
        metadata: { name: "test-run", namespace: "mn-post" },
        spec: {
          records: {
            "agency-source-id": {
              spec: {
                name: "Baxter Police Dept.",
                city: "Baxter",
                state: "MN",
                address: "13190 Memorywood Dr",
                zip_code: "56425-1000",
              },
            },
          },
        },
      },
      { recordsDirectory: "records" },
    );
    const writtenArtifacts = await Artifacts.write(
      sourceCommandDirectory,
      Artifacts.new({
        metadata: { name: "test-run", namespace: "mn-post" },
        spec: {
          artifacts: [
            {
              ref: {
                path: yamlResourceFileName("test-run", "Agencies"),
                kind: "Agencies",
              },
            },
          ],
        },
      }),
    );
    const artifactsPath = writtenArtifacts.path;
    const artifacts = await Artifacts.read(artifactsPath);
    await applyOptionalArtifactMutation(artifacts, { artifactsPath });
    const agencyArtifact = artifacts.spec.artifacts.find(
      (artifact) => artifact.kind === "Agencies",
    );
    expect(agencyArtifact?.spec.records["agency-source-id"]).toMatchObject({
      urls: { website: "https://example.test/police" },
      latitude: 46.3433,
      longitude: -94.2821,
    });
  });

  test("reads inline Artifacts artifact references before transform", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-artifacts-"));
    const writtenArtifacts = await Artifacts.write(
      rootDir,
      Artifacts.new({
        metadata: { name: "test-run", namespace: "mn-post" },
        spec: {
          artifacts: [
            {
              kind: "Agencies",
              spec: {
                records: {
                  "agency-source-id": {
                    spec: {
                      name: "Baxter Police Dept.",
                      city: "Baxter",
                      state: "MN",
                      address: "13190 Memorywood Dr",
                      zip_code: "56425-1000",
                    },
                  },
                },
              },
            },
          ],
        },
      }),
    );
    const artifacts = await Artifacts.read(writtenArtifacts.path);
    expect(artifacts.spec.artifacts).toHaveLength(1);
    expect(artifacts.spec.artifacts[0]).toMatchObject({
      kind: "Agencies",
      spec: {
        records: {
          "agency-source-id": {
            name: "Baxter Police Dept.",
            state: "MN",
          },
        },
      },
    });
  });

  test("fails on an existing successful Import for the same source Artifacts before reading mappings", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-existing-"));
    const replayImportArtifactsId = "tz4a98xxat96iws9zmbrgj3a";
    const artifactsPath = await writeSourceArtifactsFile(rootDir);
    const existingPath = path.join(
      rootDir,
      "intake",
      "commands",
      `2026-06-08T00-00-00-000Z-${replayImportArtifactsId}`,
      yamlResourceFileName(replayImportArtifactsId, "DatabaseMutations"),
    );
    await DatabaseMutations.write(
      path.dirname(existingPath),
      DatabaseMutations.new({
        metadata: {
          name: replayImportArtifactsId,
          namespace: "mn-post",
          sourceArtifactsName: "test-run",
        },
        spec: { mutations: [] },
      }),
    );
    const result = await importArtifacts({
      artifactsPath,
      env: { INTAKE_WORKSPACE_TEST: rootDir },
      logger: {
        info: () => {},
        debug: () => {},
      },
      commandName: "test-command",
      commandDirectory: path.join(
        rootDir,
        "intake",
        "commands",
        "2026-06-08T00-00-00-000Z-test-command",
      ),
    });

    expect(result).toEqual({
      ok: false,
      error: [
        `DatabaseMutations already exists for source Artifacts test-run: ${existingPath}`,
        `Replay the existing DatabaseMutations with: intake replay database-mutations ${existingPath}`,
      ].join("\n"),
    });
  });

  test("writes a replayable DatabaseMutations envelope after successful database import", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-"));
    const runId = "tz4a98xxat96iws9zmbrgj3a";
    const artifactsPath = await writeSourceArtifactsFile(rootDir);
    const artifacts = await Artifacts.read(artifactsPath);
    const commandDirectory = path.join(
      rootDir,
      "intake",
      "commands",
      `2026-06-08T00-00-00-000Z-${runId}`,
    );
    const runContext = new DataContext({
      rows,
      operations: createOperations,
      sourceNameToCanonicalIds: {
        agencies: {
          "agency-source-id": { canonicalId: "agency-canonical-id" },
        },
        personnel: {},
        agencyPersonnel: {},
        locationPaths: {},
      },
    });
    // Agencies are facade-based (ADR 0016): register the (already-resolved) agency
    // through its facade so it emits.
    const { id: _agencyId, ...agencySpec } = rows.agencies[0]!;
    runContext
      .fromSource({
        apiVersion: INTAKE_API_VERSION,
        namespace: "mn-post",
        name: "agency-source-id",
      })
      .merge(agencySpec);
    const databaseMutations = await runContext.toDatabaseMutations({
      namespace: artifacts.metadata.namespace,
      name: runId,
      sourceArtifactsName: artifacts.metadata.name,
      sourceArtifactsPath: artifactsPath,
      sourceArtifactsDigest: await Artifacts.digest(artifactsPath),
    });
    const replayImportArtifacts = await DatabaseMutations.write(
      commandDirectory,
      databaseMutations,
    );

    expect(replayImportArtifacts?.path).toContain(
      path.join(rootDir, "intake", "commands"),
    );
    expect(path.dirname(replayImportArtifacts!.path)).toMatch(
      new RegExp(
        `${path.join(rootDir, "intake", "commands").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\d{4}-\\d{2}-\\d{2}T.*-${runId}$`,
      ),
    );
    expect(path.basename(replayImportArtifacts!.path)).toBe(
      yamlResourceFileName(runId, "DatabaseMutations"),
    );
    const commandRoot = path.join(rootDir, "intake", "commands");
    const [commandFolder] = await readdir(commandRoot);
    const parsedImportArtifacts = await DatabaseMutations.read(
      path.join(
        commandRoot,
        commandFolder!,
        yamlResourceFileName(runId, "DatabaseMutations"),
      ),
    );
    expect(parsedImportArtifacts.metadata).toMatchObject({
      name: runId,
      sourceArtifactsName: "test-run",
      sourceArtifactsPath: artifactsPath,
      sourceArtifactsDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(parsedImportArtifacts.kind).toBe("DatabaseMutations");
    expect(parsedImportArtifacts.spec).toHaveProperty("mutations");
    const mutations = parsedImportArtifacts.spec.mutations as Record<
      string,
      unknown
    >[];
    const agencyMutation = mutations.find(
      (mutation) => mutation.kind === "AgencyCreate",
    );
    expect(agencyMutation).toBeDefined();
    expect(agencyMutation).not.toHaveProperty("ownedColumns");
    expect(agencyMutation).not.toHaveProperty("target");
    expect(agencyMutation?.kind).toBe("AgencyCreate");
  });

  test("persists and reuses resolved agency and personnel slugs", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-slug-cache-"));
    await persistSourceNameToCanonicalIds(
      "mn-post",
      {
        locationPaths: {},
        agencies: {
          "agency-source-id": {
            canonicalId: "agency-canonical-id",
          },
        },
        personnel: {
          "personnel-source-id": {
            canonicalId: "personnel-canonical-id",
          },
        },
        agencyPersonnel: {},
      },
      { rootDir },
    );

    async function writeArtifacts(
      name: string,
      agencyName: string,
      firstName: string,
      lastName: string,
    ): Promise<string> {
      const written = await Artifacts.write(
        rootDir,
        Artifacts.new({
          metadata: { name, namespace: "mn-post" },
          spec: {
            artifacts: [
              {
                kind: "Agencies",
                spec: {
                  records: {
                    "agency-source-id": {
                      spec: {
                        name: agencyName,
                        city: "Saint Paul",
                        state: "MN",
                        address: "444 Cedar Street",
                        zip_code: "55101",
                        contact_name: null,
                        contact_email: null,
                        location_path_id: "saint-paul-location-path-id",
                        latitude: 44.955097,
                        longitude: -93.102211,
                      },
                    },
                  },
                },
              },
              {
                kind: "Personnel",
                spec: {
                  records: {
                    "personnel-source-id": {
                      spec: {
                        first_name: firstName,
                        last_name: lastName,
                        middle_name: null,
                        prefix: null,
                        suffix: null,
                      },
                    },
                  },
                },
              },
            ],
          },
        }),
      );
      return written.path;
    }

    const firstImport = await importArtifacts({
      artifactsPath: await writeArtifacts(
        "test-run",
        "Minnesota State Patrol",
        "Spenser",
        "Stockwell",
      ),
      dryImport: true,
      env: {
        INTAKE_WORKSPACE_TEST: rootDir,
        DATABASE_URL: "postgres://example/intake",
      },
      logger: { info: () => {}, debug: () => {} },
      commandName: "first-command",
      commandDirectory: path.join(rootDir, "commands", "first-command"),
      clientFactory: () =>
        new RecordingClient(undefined, undefined, [
          {
            pattern:
              /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
            rows: locationPathSnapshot("saint-paul-location-path-id").filter(
              (locationPath) => locationPath.level === "place",
            ),
          },
          {
            pattern: /from public\.location_path\b/i,
            rows: locationPathSnapshot("saint-paul-location-path-id"),
          },
        ]),
    });

    if (!firstImport.ok) {
      throw new Error(firstImport.error);
    }
    // Agency slugs are cached in intake-owned state (ResolvedProperty). Personnel
    // slugs are facade-based (ADR 0016): stability comes from reusing the existing
    // database row's slug, not a durable slug cache, so only the agency slug is
    // asserted against the cache here.
    const agencyCacheInput = {
      subject: {
        apiVersion: INTAKE_API_VERSION,
        kind: "Agency",
        name: "agency-canonical-id",
      },
      targetProperty: "slug",
    } satisfies ResolvedPropertyCacheInput;
    await expect(
      readResolvedProperty({ ...agencyCacheInput, rootDir }),
    ).resolves.toBe("minnesota-state-patrol-icalid");

    const secondImport = await importArtifacts({
      artifactsPath: await writeArtifacts(
        "test-run-changed",
        "Changed Agency Name",
        "Changed",
        "Person",
      ),
      dryImport: true,
      env: {
        INTAKE_WORKSPACE_TEST: rootDir,
        DATABASE_URL: "postgres://example/intake",
      },
      logger: { info: () => {}, debug: () => {} },
      commandName: "second-command",
      commandDirectory: path.join(rootDir, "commands", "second-command"),
      clientFactory: () =>
        new RecordingClient(undefined, undefined, [
          {
            pattern:
              /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
            rows: locationPathSnapshot("saint-paul-location-path-id").filter(
              (locationPath) => locationPath.level === "place",
            ),
          },
          {
            pattern: /from public\.location_path\b/i,
            rows: locationPathSnapshot("saint-paul-location-path-id"),
          },
          {
            // The existing officer row carries the slug resolved on the first
            // import; the PersonnelFacade reuses it (ADR 0016), so a changed name
            // does not change the slug.
            pattern: /select \* from public\.officers where id = any/i,
            rows: [
              {
                id: "personnel-canonical-id",
                first_name: "Spenser",
                last_name: "Stockwell",
                middle_name: null,
                prefix: null,
                suffix: null,
                slug: "spenser-stockwell-icalid",
              },
            ],
          },
        ]),
    });

    expect(secondImport.ok).toBe(true);
    const databaseMutations = await DatabaseMutations.read(
      path.join(
        rootDir,
        "commands",
        "second-command",
        yamlResourceFileName("second-command", "DatabaseMutations"),
      ),
    );
    const serializedMutations = JSON.stringify(
      databaseMutations.spec.mutations,
    );
    expect(serializedMutations).toContain("minnesota-state-patrol-icalid");
    expect(serializedMutations).toContain("spenser-stockwell-icalid");
    expect(serializedMutations).not.toContain("changed-agency-name");
    expect(serializedMutations).not.toContain("changed-person");
  });

  test("imports artifacts by writing and replaying DatabaseMutations", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-pipeline-"));
    const runId = "tz4a98xxat96iws9zmbrgj3a";
    const writtenArtifacts = await Artifacts.write(
      rootDir,
      Artifacts.new({
        metadata: { name: "test-run", namespace: "mn-post" },
        spec: {
          artifacts: [
            {
              kind: "LocationPathGeometries",
              spec: {
                records: {
                  "saint-paul-geometry": {
                    spec: {
                      location_path_id: "/mn/ramsey-county/saint-paul/",
                      sourceLocationPathKey: "place:GEOID:2743000",
                      geometry: {
                        type: "Polygon",
                        coordinates: [
                          [
                            [-93.2, 44.9],
                            [-93.0, 44.9],
                            [-93.0, 45.0],
                            [-93.2, 45.0],
                            [-93.2, 44.9],
                          ],
                        ],
                      },
                    },
                  },
                },
              },
            },
            {
              kind: "Agencies",
              spec: {
                records: {
                  "agency-source-id": {
                    spec: {
                      name: "Minnesota State Patrol",
                      city: "Saint Paul",
                      state: "MN",
                      address: "444 Cedar Street",
                      zip_code: "55101",
                      contact_name: null,
                      contact_email: null,
                      slug: "minnesota-state-patrol",
                      location_path_id: "saint-paul-location-path-id",
                      latitude: 44.955097,
                      longitude: -93.102211,
                    },
                  },
                },
              },
            },
            {
              kind: "Personnel",
              spec: {
                records: {
                  "personnel-source-id": {
                    spec: {
                      first_name: "Spenser",
                      last_name: "Stockwell",
                      middle_name: null,
                      prefix: null,
                      suffix: null,
                      slug: "spenser-stockwell",
                    },
                  },
                },
              },
            },
            {
              kind: "AgencyPersonnel",
              spec: {
                records: {
                  "agency-personnel-source-id": {
                    spec: {
                      agency_id: "agency-source-id",
                      personnel_id: "personnel-source-id",
                      badge_number: "49112",
                      start_date: "2020-01-01",
                      end_date: null,
                      title: "Peace Officer",
                    },
                  },
                },
              },
            },
          ],
        },
      }),
    );
    await persistSourceNameToCanonicalIds(
      "mn-post",
      {
        locationPaths: {
          "place:GEOID:2743000": {
            kind: "LocationPath",
            canonicalId: "mn/saint-paul/minnesota-state-patrol",
          },
        },
        agencies: {
          "agency-source-id": {
            kind: "Agency",
            canonicalId: "agency-canonical-id",
          },
        },
        personnel: {
          "personnel-source-id": {
            kind: "Personnel",
            canonicalId: "personnel-canonical-id",
          },
        },
        agencyPersonnel: {
          "agency-personnel-source-id": {
            kind: "AgencyPersonnel",
            canonicalId: "agency-personnel-canonical-id",
          },
        },
      },
      { rootDir },
    );
    const commandDirectory = path.join(
      rootDir,
      "intake",
      "commands",
      `2026-06-08T00-00-00-000Z-${runId}`,
    );
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern:
          /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
        rows: locationPathSnapshot("saint-paul-location-path-id").filter(
          (locationPath) => locationPath.level === "place",
        ),
      },
    ]);

    const result = await importArtifacts({
      artifactsPath: writtenArtifacts.path,
      env: {
        DATABASE_URL: "postgres://example/intake",
        INTAKE_WORKSPACE_TEST: rootDir,
      },
      logger: {
        info: () => {},
        debug: () => {},
      },
      commandName: runId,
      commandDirectory,
      clientFactory: () => client,
    });

    expect(result).toEqual({
      ok: true,
      counts: {
        mutations: 4,
        recordsByEntityType: {
          Agency: 1,
          AgencyPersonnel: 1,
          LocationPathGeometry: 1,
          Personnel: 1,
        },
      },
    });
    const databaseMutations = await DatabaseMutations.read(
      path.join(
        commandDirectory,
        yamlResourceFileName(runId, "DatabaseMutations"),
      ),
    );
    expect(databaseMutations).toMatchObject({
      metadata: { name: runId, namespace: "mn-post" },
    });
    expect(databaseMutations.spec.mutations).toContainEqual(
      expect.objectContaining({
        kind: "AgencyCreate",
        name: "agency-source-id",
        spec: expect.objectContaining({
          id: "agency-canonical-id",
        }),
      }),
    );
    expect(databaseMutations.spec.mutations).toContainEqual(
      expect.objectContaining({
        kind: "PersonnelCreate",
        name: "personnel-source-id",
        spec: expect.objectContaining({
          id: "personnel-canonical-id",
        }),
      }),
    );
    expect(databaseMutations.spec.mutations).toContainEqual(
      expect.objectContaining({
        kind: "AgencyPersonnelCreate",
        name: "agency-personnel-source-id",
        spec: expect.objectContaining({
          id: "agency-personnel-canonical-id",
          agency_id: "agency-canonical-id",
          personnel_id: "personnel-canonical-id",
        }),
      }),
    );
    expect(
      client.queries.some(({ text }) =>
        /^insert into public\.agency\b/i.test(text),
      ),
    ).toBe(true);
    const agencyPersonnelInsert = client.queries.find(({ text }) =>
      /^insert into public\.agency_officers\b/i.test(text),
    );
    expect(agencyPersonnelInsert?.text).toContain("officer_id");
    expect(agencyPersonnelInsert?.text).not.toContain("personnel_id");
  });

  test("streams location path geometry using the location path artifact key when sourceLocationPathKey is not mapped", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-geometry-key-"));
    const runId = "geometry-key-fallback";
    const writtenArtifacts = await Artifacts.write(
      rootDir,
      Artifacts.new({
        metadata: { name: "test-run", namespace: "us-census-gazetteer" },
        spec: {
          artifacts: [
            {
              kind: "LocationPaths",
              spec: {
                records: {
                  "/ak/": {
                    spec: {
                      location_path_id: "/ak/",
                      path: "/ak/",
                      level: "state",
                      state_or_territory_slug: "ak",
                      administrative_area_slug: null,
                      place_slug: null,
                      state_or_territory_name: "Alaska",
                      administrative_area_name: null,
                      place_name: null,
                      parent_location_path_id: null,
                    },
                  },
                },
              },
            },
            {
              kind: "LocationPathGeometries",
              spec: {
                records: {
                  "/ak/": {
                    spec: {
                      location_path_id: "/ak/",
                      sourceLocationPathKey: "state:GEOID:02",
                      geometry: {
                        type: "Polygon",
                        coordinates: [
                          [
                            [-170, 50],
                            [-130, 50],
                            [-130, 72],
                            [-170, 72],
                            [-170, 50],
                          ],
                        ],
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      }),
    );
    await persistSourceNameToCanonicalIds(
      "us-census-gazetteer",
      {
        locationPaths: {
          "/ak/": {
            kind: "LocationPath",
            canonicalId: "alaska-canonical-location-path-id",
          },
        },
        agencies: {},
        personnel: {},
        agencyPersonnel: {},
      },
      { rootDir },
    );
    const commandDirectory = path.join(
      rootDir,
      "intake",
      "commands",
      `2026-06-08T00-00-00-000Z-${runId}`,
    );
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /from public\.location_path\b/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path_geometry\b/i,
        rows: [],
      },
    ]);

    const result = await importArtifacts({
      artifactsPath: writtenArtifacts.path,
      env: {
        DATABASE_URL: "postgres://example/intake",
        INTAKE_WORKSPACE_TEST: rootDir,
      },
      logger: {
        info: () => {},
        debug: () => {},
      },
      commandName: runId,
      commandDirectory,
      dryImport: true,
      clientFactory: () => client,
    });

    expect(result).toEqual({
      ok: true,
      counts: {
        mutations: 2,
        recordsByEntityType: {
          LocationPath: 1,
          LocationPathGeometry: 1,
        },
      },
    });
    const databaseMutations = await DatabaseMutations.read(
      path.join(
        commandDirectory,
        yamlResourceFileName(runId, "DatabaseMutations"),
      ),
    );
    expect(databaseMutations.spec.mutations).toContainEqual(
      expect.objectContaining({
        kind: "LocationPathGeometryCreate",
        name: "alaska-canonical-location-path-id",
        spec: expect.objectContaining({
          location_path_id: "alaska-canonical-location-path-id",
          sourceLocationPathKey: "state:GEOID:02",
        }),
      }),
    );
  });

  test("replays DatabaseMutations through database CRU", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-ref-"));
    const writtenAgencyCreate = await AgencyCreate.write(
      path.join(rootDir, "mutations"),
      AgencyCreate.new({
        metadata: {
          name: "agency-canonical-id",
          namespace: "mn-post",
        },
        spec: rows.agencies[0] as Parameters<
          typeof AgencyCreate.new
        >[0]["spec"],
      }),
    );
    const writtenImportArtifacts = await DatabaseMutations.write(
      rootDir,
      DatabaseMutations.new({
        metadata: {
          name: "run-1",
          namespace: "mn-post",
        },
        spec: {
          mutations: [
            {
              ref: {
                path: path.relative(rootDir, writtenAgencyCreate.path),
                kind: "AgencyCreate",
              },
            },
          ],
        },
      }),
    );

    const client = new RecordingClient();
    const result = await replayDatabaseMutations({
      databaseMutationsPath: writtenImportArtifacts.path,
      env: { DATABASE_URL: "postgres://example" },
      clientFactory: () => client,
    });

    expect(result).toEqual({
      ok: true,
      counts: {
        mutations: 1,
        recordsByEntityType: {
          Agency: 1,
        },
      },
    });
    expect(
      client.queries.some((query) =>
        /^insert into public\.agency/i.test(query.text),
      ),
    ).toBe(true);
  });

  test("replays location path centroid and bbox as PostGIS values", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-ref-"));
    const writtenLocationPathCreate = await LocationPathCreate.write(
      path.join(rootDir, "mutations"),
      LocationPathCreate.new({
        metadata: {
          name: "location-path-id",
          namespace: "mn-post",
        },
        spec: {
          location_path_id: "location-path-id",
          path: "/mn/ramsey-county/saint-paul/",
          level: "place",
          state_or_territory_slug: "mn",
          administrative_area_slug: "ramsey-county",
          place_slug: "saint-paul",
          state_or_territory_name: "Minnesota",
          administrative_area_name: "Ramsey County",
          place_name: "Saint Paul",
          parent_location_path_id: "ramsey-county-location-path-id",
          centroid: {
            type: "Point",
            coordinates: [-93.09, 44.9537],
          },
          bbox: {
            type: "Polygon",
            coordinates: [
              [
                [-93.23, 44.88],
                [-92.98, 44.88],
                [-92.98, 45.03],
                [-93.23, 45.03],
                [-93.23, 44.88],
              ],
            ],
          },
        },
      }),
    );
    const writtenImportArtifacts = await DatabaseMutations.write(
      rootDir,
      DatabaseMutations.new({
        metadata: {
          name: "run-1",
          namespace: "mn-post",
        },
        spec: {
          mutations: [
            {
              ref: {
                path: path.relative(rootDir, writtenLocationPathCreate.path),
                kind: "LocationPathCreate",
              },
            },
          ],
        },
      }),
    );

    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /from public\.location_path\b/i,
        rows: [],
      },
    ]);
    const result = await replayDatabaseMutations({
      databaseMutationsPath: writtenImportArtifacts.path,
      env: { DATABASE_URL: "postgres://example" },
      clientFactory: () => client,
    });

    expect(result).toEqual({
      ok: true,
      counts: {
        mutations: 1,
        recordsByEntityType: {
          LocationPath: 1,
        },
      },
    });
    const insert = client.queries.find((query) =>
      /^insert into public\.location_path/i.test(query.text),
    );
    expect(insert?.text).toContain("centroid");
    expect(insert?.text).toContain("bbox");
    expect(insert?.text).toContain("ST_GeomFromGeoJSON");
    expect(insert?.values).toContain(
      JSON.stringify({ type: "Point", coordinates: [-93.09, 44.9537] }),
    );
    expect(insert?.values).toContain(
      JSON.stringify({
        type: "Polygon",
        coordinates: [
          [
            [-93.23, 44.88],
            [-92.98, 44.88],
            [-92.98, 45.03],
            [-93.23, 45.03],
            [-93.23, 44.88],
          ],
        ],
      }),
    );
  });

  test("replays location path geometry as boundary PostGIS value", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-geometry-"));
    const boundary = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [-93.23, 44.88],
            [-92.98, 44.88],
            [-92.98, 45.03],
            [-93.23, 45.03],
            [-93.23, 44.88],
          ],
        ],
      ],
    };
    const writtenLocationPathGeometryCreate =
      await LocationPathGeometryCreate.write(
        path.join(rootDir, "mutations"),
        LocationPathGeometryCreate.new({
          metadata: {
            name: "location-path-id",
            namespace: "mn-post",
          },
          spec: {
            location_path_id: "location-path-id",
            sourceLocationPathKey: "place:GEOID:2743000",
            geometry: boundary,
          },
        }),
      );
    const writtenImportArtifacts = await DatabaseMutations.write(
      rootDir,
      DatabaseMutations.new({
        metadata: {
          name: "run-1",
          namespace: "mn-post",
        },
        spec: {
          mutations: [
            {
              ref: {
                path: path.relative(
                  rootDir,
                  writtenLocationPathGeometryCreate.path,
                ),
                kind: "LocationPathGeometryCreate",
              },
            },
          ],
        },
      }),
    );

    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /from public\.location_path_geometry\b/i,
        rows: [],
      },
    ]);
    const result = await replayDatabaseMutations({
      databaseMutationsPath: writtenImportArtifacts.path,
      env: { DATABASE_URL: "postgres://example" },
      clientFactory: () => client,
    });

    expect(result).toEqual({
      ok: true,
      counts: {
        mutations: 1,
        recordsByEntityType: {
          LocationPathGeometry: 1,
        },
      },
    });
    const insert = client.queries.find((query) =>
      /^insert into public\.location_path_geometry/i.test(query.text),
    );
    expect(insert?.text).toContain("boundary");
    expect(insert?.text).toContain("ST_GeomFromGeoJSON");
    expect(insert?.values).toEqual([
      "location-path-id",
      JSON.stringify(boundary),
    ]);
  });

  test("replays an existing DatabaseMutations without writing another DatabaseMutations envelope", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-replay-"));
    const artifactsPath = await writeSourceArtifactsFile(rootDir);
    const artifacts = await Artifacts.read(artifactsPath);
    const replayImportArtifactsArtifact = await DatabaseMutations.write(
      path.join(
        rootDir,
        "intake",
        "commands",
        "2026-06-08T00-00-00-000Z-test-command",
      ),
      DatabaseMutations.new({
        metadata: {
          namespace: artifacts.metadata.namespace,
          name: "test-command",
          sourceArtifactsName: artifacts.metadata.name,
          sourceArtifactsPath: artifactsPath,
          sourceArtifactsDigest: await Artifacts.digest(artifactsPath),
        },
        spec: { mutations: [] },
      }),
    );
    const commandDirectory = path.dirname(replayImportArtifactsArtifact!.path);
    const filesBeforeReplay = await readdir(commandDirectory);

    const result = await replayDatabaseMutations({
      databaseMutationsPath: replayImportArtifactsArtifact!.path,
      env: {},
    });

    expect(result).toEqual({
      ok: false,
      error: "DATABASE_URL is required to replay DatabaseMutations.",
    });
    await expect(readdir(commandDirectory)).resolves.toEqual(filesBeforeReplay);
  });

  test("records artifact mutation reference in import-artifacts replay metadata", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-mutation-"));
    const artifactsPath = await writeSourceArtifactsFile(rootDir);
    const artifacts = await Artifacts.read(artifactsPath);
    const mutationPath = path.join(
      path.dirname(artifactsPath),
      yamlResourceFileName("test-run", "ArtifactMutations"),
    );

    const replayImportArtifacts = await DatabaseMutations.write(
      path.join(
        rootDir,
        "intake",
        "commands",
        "2026-06-08T00-00-00-000Z-test-command",
      ),
      DatabaseMutations.new({
        metadata: {
          namespace: artifacts.metadata.namespace,
          name: "test-command",
          sourceArtifactsName: artifacts.metadata.name,
          sourceArtifactsPath: artifactsPath,
          sourceArtifactsDigest: await Artifacts.digest(artifactsPath),
          artifactMutation: {
            path: mutationPath,
            digest: "sha256:1234",
          },
        },
        spec: { mutations: [] },
      }),
    );

    const importArtifactsEnvelope = await DatabaseMutations.read(
      replayImportArtifacts!.path,
    );

    expect(importArtifactsEnvelope.metadata.artifactMutation).toEqual({
      path: mutationPath,
      digest: "sha256:1234",
    });
  });

  test("writes a debug DatabaseMutations envelope with preparation errors", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-debug-"));
    const runId = "tz4a98xxat96iws9zmbrgj3a";
    const artifactsPath = await writeSourceArtifactsFile(rootDir);
    const artifacts = await Artifacts.read(artifactsPath);
    const replayImportArtifacts = await DatabaseMutationsDebug.write(
      path.join(
        rootDir,
        "intake",
        "commands",
        `2026-06-08T00-00-00-000Z-${runId}`,
      ),
      DatabaseMutationsDebug.new({
        metadata: {
          namespace: artifacts.metadata.namespace,
          name: runId,
          sourceArtifactsName: artifacts.metadata.name,
          sourceArtifactsPath: artifactsPath,
          sourceArtifactsDigest: await Artifacts.digest(artifactsPath),
          status: "failed",
          counts: {
            agencies: 1,
            personnel: 2,
            agencyPersonnel: 3,
          },
          ownedColumns: {
            agency: ["name"],
            personnel: ["first_name", "last_name"],
            agencyPersonnel: ["agency_id", "personnel_id"],
          },
          errors: ["missing latitude", "missing longitude"],
        },
        spec: { mutations: [] },
      }),
    );

    expect(path.basename(replayImportArtifacts!.path)).toBe(
      yamlResourceFileName(runId, "DatabaseMutationsDebug"),
    );
    const parsedImportArtifacts = await DatabaseMutationsDebug.read(
      replayImportArtifacts!.path,
    );
    expect(parsedImportArtifacts.kind).toBe("DatabaseMutationsDebug");
    expect(parsedImportArtifacts.metadata).toMatchObject({
      name: runId,
      sourceArtifactsName: "test-run",
      sourceArtifactsDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      counts: {
        agencies: 1,
        personnel: 2,
        agencyPersonnel: 3,
      },
      ownedColumns: {
        agency: ["name"],
        personnel: ["first_name", "last_name"],
        agencyPersonnel: ["agency_id", "personnel_id"],
      },
    });
    expect(parsedImportArtifacts.spec).toHaveProperty("mutations");
  });

  test("debug DatabaseMutations accepts failed inline mutation specs for inspection", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-debug-"));
    const runId = "tz4a98xxat96iws9zmbrgj3a";
    const replayImportArtifacts = await DatabaseMutationsDebug.write(
      path.join(
        rootDir,
        "intake",
        "commands",
        `2026-06-08T00-00-00-000Z-${runId}`,
      ),
      DatabaseMutationsDebug.new({
        metadata: {
          namespace: "mn-post",
          name: runId,
          status: "failed",
          counts: {
            agencies: 1,
          },
          errors: ["missing latitude"],
        },
        spec: {
          mutations: [
            {
              kind: "AgencyCreate",
              name: "agency-canonical-id",
              spec: {
                id: "agency-canonical-id",
              },
            },
          ],
        },
      }),
    );

    const parsedImportArtifacts = await DatabaseMutationsDebug.read(
      replayImportArtifacts.path,
    );

    expect(parsedImportArtifacts.spec.mutations).toEqual([
      {
        kind: "AgencyCreate",
        name: "agency-canonical-id",
        spec: {
          id: "agency-canonical-id",
        },
      },
    ]);
  });

  test("uses INTAKE_WORKSPACE for import-artifacts replay artifacts when INTAKE_WORKSPACE_TEST is unset", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-root-"));
    const artifactsPath = await writeSourceArtifactsFile(rootDir);
    const artifacts = await Artifacts.read(artifactsPath);
    const replayImportArtifacts = await DatabaseMutations.write(
      path.join(
        rootDir,
        "intake",
        "commands",
        "2026-06-08T00-00-00-000Z-test-command",
      ),
      DatabaseMutations.new({
        metadata: {
          namespace: artifacts.metadata.namespace,
          name: "test-command",
          sourceArtifactsName: artifacts.metadata.name,
          sourceArtifactsPath: artifactsPath,
          sourceArtifactsDigest: await Artifacts.digest(artifactsPath),
        },
        spec: { mutations: [] },
      }),
    );

    expect(replayImportArtifacts?.path).toContain(
      path.join(rootDir, "intake", "commands"),
    );
    const commandRoot = path.join(rootDir, "intake", "commands");
    await expect(readdir(commandRoot)).resolves.toHaveLength(1);
  });

  test("reports a clear error when the import-artifacts replay output directory is not writable", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-root-"));
    const workspaceFile = path.join(rootDir, "workspace-file");
    await writeFile(workspaceFile, "not a directory");
    const artifactsPath = await writeSourceArtifactsFile(rootDir);
    const artifacts = await Artifacts.read(artifactsPath);
    const commandRoot = path.join(workspaceFile, "intake", "commands");

    await expect(
      DatabaseMutations.write(
        path.join(commandRoot, "2026-06-08T00-00-00-000Z-test-command"),
        DatabaseMutations.new({
          metadata: {
            namespace: artifacts.metadata.namespace,
            name: "test-command",
            sourceArtifactsName: artifacts.metadata.name,
            sourceArtifactsPath: artifactsPath,
            sourceArtifactsDigest: await Artifacts.digest(artifactsPath),
          },
          spec: { mutations: [] },
        }),
      ),
    ).rejects.toThrow();
  });

  test("CLI writes import progress to terminal and pino log file idempotently", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-logs-"));
    const workspace = path.join(rootDir, "workspace");
    const artifactsPath = path.join(
      workspace,
      "mn-post",
      "commands",
      "test-run",
      "artifacts.yaml",
    );
    let terminalOutput = "";

    const result = await runImportArtifactsCommand(artifactsPath, {
      env: { INTAKE_WORKSPACE: workspace },
      now: new Date("2026-06-10T00:00:00.000Z"),
      createCommandName: () => "tz4a98xxat96iws9zmbrgj3a",
      terminal: { write: (text) => (terminalOutput += text) },
      importArtifacts: async () => ({
        ok: true,
        counts: {
          mutations: 15,
          recordsByEntityType: {
            Agency: 1,
            AgencyPersonnel: 3,
            LocationPath: 4,
            LocationPathAlias: 5,
            Personnel: 2,
          },
        },
      }),
    });

    const logPath = path.join(
      workspace,
      "intake",
      "commands",
      "2026-06-10T00-00-00-000Z-tz4a98xxat96iws9zmbrgj3a",
      "tz4a98xxat96iws9zmbrgj3a.log",
    );
    const commandPath = path.join(
      workspace,
      "intake",
      "commands",
      "2026-06-10T00-00-00-000Z-tz4a98xxat96iws9zmbrgj3a",
      "tz4a98xxat96iws9zmbrgj3a.Command.yaml",
    );
    const logLines = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const command = await CommandEnvelope.read(commandPath);

    expect(result.exitCode).toBe(0);
    expect(command).toMatchObject({
      kind: "Command",
      metadata: {
        name: "tz4a98xxat96iws9zmbrgj3a",
        namespace: "intake",
      },
      spec: {
        path: ".",
        statePath: "../../state",
        sharedIoRoot: path.join(process.cwd(), "dist", "shared", "io"),
        args: ["import", "artifacts", artifactsPath],
      },
    });
    expect(terminalOutput).toContain(`Writing logs to ${logPath}`);
    expect(terminalOutput).toContain("Log level: info");
    expect(terminalOutput).toContain(`Importing artifacts: ${artifactsPath}`);
    expect(terminalOutput).toContain("Artifacts import succeeded.");
    expect(result.stdout).toContain("Imported artifact database records.");
    expect(result.stdout).toContain("Database mutations: 15");
    expect(result.stdout).toContain("LocationPath: 4");
    expect(result.stdout).toContain("LocationPathAlias: 5");
    expect(logLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 30,
          msg: "Artifacts import started.",
          artifactsPath,
        }),
        expect.objectContaining({
          level: 30,
          msg: "Artifacts import succeeded.",
          databaseMutations: 15,
          recordsByEntityType: {
            Agency: 1,
            AgencyPersonnel: 3,
            LocationPath: 4,
            LocationPathAlias: 5,
            Personnel: 2,
          },
        }),
      ]),
    );
  });

  test("CLI dry run reports ImportArtifacts creation without database create/read/update", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-logs-"));
    const workspace = path.join(rootDir, "workspace");
    let terminalOutput = "";
    let receivedDryImport: boolean | undefined;

    const result = await runImportArtifactsCommand("artifacts.yaml", {
      env: { INTAKE_WORKSPACE: workspace },
      dryImport: true,
      terminal: { write: (text) => (terminalOutput += text) },
      importArtifacts: async (input) => {
        receivedDryImport = input.dryImport;
        return {
          ok: true,
          counts: {
            mutations: 15,
            recordsByEntityType: {
              Agency: 1,
              AgencyPersonnel: 3,
              LocationPath: 4,
              LocationPathAlias: 5,
              Personnel: 2,
            },
          },
        };
      },
    });

    expect(receivedDryImport).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(terminalOutput).toContain(
      "Dry run: DatabaseMutations envelope will be created without database create/read/update.",
    );
    expect(result.stdout).toContain(
      "Created DatabaseMutations envelope. Database apply skipped.",
    );
    expect(result.stdout).toContain("Database mutations: 15");
    expect(result.stdout).toContain("LocationPath: 4");
    expect(result.stdout).toContain("LocationPathAlias: 5");
  });

  test("CLI honors LOG_LEVEL for observable debug logging", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-logs-"));
    const workspace = path.join(rootDir, "workspace");
    const artifactsPath = path.join(
      workspace,
      "mn-post",
      "commands",
      "test-run",
      "artifacts.yaml",
    );
    let terminalOutput = "";

    const result = await runImportArtifactsCommand(artifactsPath, {
      env: { INTAKE_WORKSPACE: workspace, LOG_LEVEL: "debug" },
      now: new Date("2026-06-10T00:00:00.000Z"),
      createCommandName: () => "tz4a98xxat96iws9zmbrgj3a",
      terminal: { write: (text) => (terminalOutput += text) },
      importArtifacts: async (input) => {
        input.logger?.debug({ debugVisible: true }, "Debug import detail.");
        return {
          ok: true,
          counts: { mutations: 0, recordsByEntityType: {} },
        };
      },
    });

    const logPath = path.join(
      workspace,
      "intake",
      "commands",
      "2026-06-10T00-00-00-000Z-tz4a98xxat96iws9zmbrgj3a",
      "tz4a98xxat96iws9zmbrgj3a.log",
    );
    const logLines = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(result.exitCode).toBe(0);
    expect(terminalOutput).toContain("Log level: debug");
    expect(terminalOutput).toContain("Debug import detail.");
    expect(logLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 20,
          msg: "Debug import detail.",
          debugVisible: true,
        }),
      ]),
    );
  });

  test("writer failure returns failure and CLI does not report success", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-logs-"));
    const workspace = path.join(rootDir, "workspace");
    const importResult = {
      ok: false,
      error: "duplicate key value violates unique constraint",
    } as const;

    const cliResult = await runImportArtifactsCommand("artifacts.yaml", {
      env: { INTAKE_WORKSPACE: workspace },
      terminal: false,
      importArtifacts: async () => importResult,
    });

    expect(cliResult.exitCode).toBe(1);
    expect(cliResult.stderr).toContain(
      "duplicate key value violates unique constraint",
    );
    expect(cliResult.stdout ?? "").not.toContain("Imported artifacts");
  });
});
