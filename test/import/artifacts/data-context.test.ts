import { describe, expect, test } from "vitest";
import {
  DataContext,
  type DataContextOptions,
} from "../../../src/cli/import/artifacts/data-context.js";
import type { DatabaseClient } from "../../../src/cli/database/index.js";
import type {
  ImportRows,
  LocationPathRow,
} from "../../../src/cli/import/artifacts/transform.js";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import { countDatabaseMutations } from "../../../src/cli/import/artifacts/io/DatabaseMutationCounts.js";
import {
  loadSourceNameToCanonicalIds,
  persistSourceNameToCanonicalIds,
  type SourceNameToCanonicalIds,
} from "../../../src/cli/state/source-name-to-canonical-id/index.js";

class EmptyClient implements DatabaseClient {
  async connect(): Promise<void> {}

  async query(
    _text = "",
    _values: readonly unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    return { rows: [] };
  }

  async end(): Promise<void> {}
}

class BoundaryClient extends EmptyClient {
  async query(text: string): Promise<{ rows: Record<string, unknown>[] }> {
    if (/join public\.location_path_geometry\b/i.test(text)) {
      return {
        rows: locationPaths.filter(
          (locationPath) => locationPath.level === "place",
        ),
      };
    }

    return { rows: [] };
  }
}

const rows: ImportRows = {
  locationPaths: [],
  locationPathAliases: [],
  agencies: [],
  agencyOfficers: [],
  preparationMutations: [],
  ownedColumns: {
    agencies: {},
    agencyOfficers: {},
  },
};

const locationPaths: LocationPathRow[] = [
  {
    location_path_id: "mn-location-path-id",
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
    parent_location_path_id: "mn-location-path-id",
  },
  {
    location_path_id: "saint-paul-location-path-id",
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

const txLocationPath: LocationPathRow = {
  location_path_id: "tx-location-path-id",
  path: "/tx/",
  level: "state",
  state_or_territory_slug: "tx",
  administrative_area_slug: null,
  place_slug: null,
  state_or_territory_name: "Texas",
  administrative_area_name: null,
  place_name: null,
  parent_location_path_id: null,
};

function licensingSourceNameToCanonicalIds(
  licensingAuthorities: SourceNameToCanonicalIds["licensingAuthorities"],
): SourceNameToCanonicalIds {
  return {
    agencies: {},
    personnel: {},
    agencyPersonnel: {},
    locationPaths: {},
    licensingAuthorities,
  };
}

function licensingContext(
  sourceNameToCanonicalIds: SourceNameToCanonicalIds,
): DataContext {
  return new DataContext({
    client: new EmptyClient(),
    rows,
    commandName: "command-name",
    // A loaded snapshot lets getByPath resolve "/tx/" and return undefined for
    // an unknown state without reaching a live client (resolve-or-fail path).
    databaseLocationPaths: [txLocationPath],
    databaseLocationPathAliases: [],
    sourceNameToCanonicalIds,
  });
}

describe("DataContext", () => {
  function agencyFacadeContext(options?: {
    client?: DatabaseClient;
    databaseAgencies?: Record<string, unknown>[];
    resolveAddress?: (input: unknown) => Promise<unknown>;
    databaseLocationPaths?: LocationPathRow[];
    rows?: ImportRows;
  }): DataContext {
    return new DataContext({
      client: options?.client ?? new EmptyClient(),
      rows: options?.rows ?? rows,
      commandName: "command-name",
      sourceNameToCanonicalIds: {
        agencies: {
          "mn-state-patrol": { canonicalId: "agency-canonical-id" },
        },
        personnel: {},
        agencyPersonnel: {},
        locationPaths: {},
      },
      ...(options?.databaseAgencies === undefined
        ? {}
        : { databaseAgencies: options.databaseAgencies }),
      ...(options?.databaseLocationPaths === undefined
        ? {}
        : {
            databaseLocationPaths: options.databaseLocationPaths,
            databaseLocationPathAliases: [],
          }),
      ...(options?.resolveAddress === undefined
        ? {}
        : {
            resolveAddress:
              options.resolveAddress as DataContextOptions["resolveAddress"],
          }),
    });
  }

  const resolvedAgencySpec = {
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
  };

  test("AgencyFacade emits AgencyCreate when no current database row exists", async () => {
    const context = agencyFacadeContext();
    const agency = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });
    agency.merge(resolvedAgencySpec);

    expect(await agency.toMutation()).toMatchObject({
      kind: "AgencyCreate",
      metadata: { namespace: "mn-post", name: "mn-state-patrol" },
      spec: {
        id: "agency-canonical-id",
        name: "Minnesota State Patrol",
        slug: "minnesota-state-patrol",
        location_path_id: "saint-paul-location-path-id",
        latitude: 44.955097,
        longitude: -93.102211,
      },
    });
  });

  test("AgencyFacade location_path_id composition fails loud when the address cannot resolve", async () => {
    // Resolve-or-fail (ADR 0006/0015): a new agency with no pre-resolved
    // location_path_id and no geocoder cannot resolve, and fails loud.
    const context = agencyFacadeContext();
    const agency = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });
    agency.merge({ name: "Minnesota State Patrol", state: "MN" });

    await expect(agency.toMutation()).rejects.toThrow(
      /Cannot resolve address for agency mn-state-patrol/,
    );
  });

  test("AgencyCreate rejects a spec missing a required plain field", async () => {
    const context = agencyFacadeContext();
    const agency = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });
    // Every resolvable field is present, but the required plain `name` is absent,
    // so the assembled AgencyCreate fails its schema validation.
    const { name: _name, ...withoutName } = resolvedAgencySpec;
    agency.merge(withoutName);

    await expect(agency.toMutation()).rejects.toThrow(
      "AgencyCreate is malformed",
    );
  });

  test("AgencyFacade emits AgencyUpdate with checks and from-to sets when current row exists", async () => {
    const context = agencyFacadeContext({
      databaseAgencies: [
        { id: "agency-canonical-id", ...resolvedAgencySpec },
      ],
    });
    const agency = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });
    agency.merge({ ...resolvedAgencySpec, slug: "msp" });

    expect(await agency.toMutation()).toMatchObject({
      kind: "AgencyUpdate",
      metadata: { namespace: "mn-post", name: "mn-state-patrol" },
      spec: {
        operations: expect.arrayContaining([
          expect.objectContaining({
            action: "check",
            path: "name",
            value: "Minnesota State Patrol",
          }),
          expect.objectContaining({
            action: "set",
            path: "slug",
            from: "minnesota-state-patrol",
            to: "msp",
          }),
        ]),
      },
    });
  });

  test("returns the same facade for the same source identity", () => {
    const context = new DataContext({
      client: new EmptyClient(),
      rows,
      databaseLocationPaths: locationPaths,
      databaseLocationPathAliases: [],
    });

    const first = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });
    first.merge({ name: "Minnesota State Patrol" });

    const second = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });

    expect(second).toBe(first);
    expect(second.raw("name")).toBe("Minnesota State Patrol");
  });

  test("creates agency facade with canonical ID from source mapping and collects create mutation", async () => {
    const context = new DataContext({
      client: new EmptyClient(),
      rows,
      commandName: "command-name",
      sourceNameToCanonicalIds: {
        agencies: {
          "mn-state-patrol": { canonicalId: "agency-canonical-id" },
        },
        personnel: {},
        agencyPersonnel: {},
        locationPaths: {},
      },
    });

    const agency = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });
    agency.merge({
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
    });

    expect(await context.toMutations()).toMatchObject([
      {
        kind: "AgencyCreate",
        metadata: { namespace: "mn-post", name: "mn-state-patrol" },
        spec: { id: "agency-canonical-id" },
      },
    ]);
  });

  test("collects touched facades into a DatabaseMutations envelope", async () => {
    const context = new DataContext({
      client: new EmptyClient(),
      rows,
      commandName: "command-name",
      sourceNameToCanonicalIds: {
        agencies: {
          "mn-state-patrol": { canonicalId: "agency-canonical-id" },
        },
        personnel: {},
        agencyPersonnel: {},
        locationPaths: {},
      },
    });

    const agency = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });
    agency.merge({
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
    });

    expect(
      await context.toDatabaseMutations({
        namespace: "mn-post",
        name: "command-name",
        sourceArtifactsName: "source-artifacts-name",
      }),
    ).toMatchObject({
      kind: "DatabaseMutations",
      metadata: {
        namespace: "mn-post",
        name: "command-name",
        sourceArtifactsName: "source-artifacts-name",
      },
      spec: {
        mutations: [
          {
            kind: "AgencyCreate",
            name: "mn-state-patrol",
            spec: { id: "agency-canonical-id" },
          },
        ],
      },
    });
  });

  test("emits empty specs for read-only location path mutations", async () => {
    const existingLocationPath = locationPaths[0]!;
    const context = new DataContext({
      rows: {
        ...rows,
        locationPaths: [existingLocationPath],
      },
      operations: {
        locationPaths: {
          [existingLocationPath.location_path_id]: "read",
        },
        locationPathGeometries: {},
        locationPathAliases: {},
        agencies: {},
        officers: {},
        agencyOfficers: {},
        licensingAuthorities: {},
        licenses: {},
        licenseActions: {},
      },
    });

    expect(
      await context.toDatabaseMutations({
        namespace: "mn-post",
        name: "command-name",
      }),
    ).toMatchObject({
      spec: {
        mutations: [
          {
            kind: "LocationPathRead",
            name: existingLocationPath.location_path_id,
            spec: {},
          },
        ],
      },
    });
  });

  test("creates agency facade with current database row and collects update mutation", async () => {
    const context = agencyFacadeContext({
      databaseAgencies: [
        { id: "agency-canonical-id", ...resolvedAgencySpec },
      ],
    });

    const agency = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });
    agency.merge({ ...resolvedAgencySpec, slug: "msp" });

    expect(await context.toMutations()).toMatchObject([
      {
        kind: "AgencyUpdate",
        metadata: { namespace: "mn-post", name: "mn-state-patrol" },
        spec: {
          operations: expect.arrayContaining([
            expect.objectContaining({ action: "check", path: "name" }),
            expect.objectContaining({
              action: "set",
              path: "slug",
              from: "minnesota-state-patrol",
              to: "msp",
            }),
          ]),
        },
      },
    ]);
  });

  test("AgencyFacade location_path_id composition resolver geocodes then resolves the containing boundary", async () => {
    // The composition resolver (ADR 0016): geocode the address, then
    // point-in-polygon containment against the location hierarchy.
    const context = new DataContext({
      client: new BoundaryClient(),
      rows,
      commandName: "command-name",
      sourceNameToCanonicalIds: {
        agencies: {
          "mn-state-patrol": { canonicalId: "agency-canonical-id" },
        },
        personnel: {},
        agencyPersonnel: {},
        locationPaths: {},
      },
      databaseLocationPaths: locationPaths,
      databaseLocationPathAliases: [],
      resolveAddress: async () => ({
        latitude: 44.955097,
        longitude: -93.102211,
      }),
    });

    const agency = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });
    // No location_path_id supplied — the composition resolver derives it.
    agency.merge({
      name: "Minnesota State Patrol",
      address: "444 Cedar Street",
      city: "Saint Paul",
      state: "MN",
      zip_code: "55101",
    });

    await expect(agency.value("location_path_id")).resolves.toBe(
      "saint-paul-location-path-id",
    );
    await expect(agency.value("latitude")).resolves.toBe(44.955097);
  });

  test("AgencyFacade finds a seeded canonical id, else mints and persists it", async () => {
    const persisted: SourceNameToCanonicalIds[] = [];
    const context = new DataContext({
      client: new EmptyClient(),
      rows,
      commandName: "command-name",
      sourceNameToCanonicalIds: {
        agencies: { seeded: { canonicalId: "seeded-agency-id" } },
        personnel: {},
        agencyPersonnel: {},
        locationPaths: {},
      },
      persistSourceNameToCanonicalIds: async (_namespace, mappings) => {
        persisted.push(JSON.parse(JSON.stringify(mappings)));
      },
    });

    const seeded = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "seeded",
    });
    await expect(seeded.value("id")).resolves.toBe("seeded-agency-id");

    const minted = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "new-agency",
    });
    const mintedId = await minted.value("id");
    expect(mintedId).not.toBe("seeded-agency-id");
    expect(mintedId).toMatch(/^[0-9a-z]+$/);
    expect(persisted.at(-1)?.agencies["new-agency"]).toEqual({
      kind: "Agency",
      canonicalId: mintedId,
    });
  });

  test("AgencyFacade generates a slug from the name when none is supplied", async () => {
    const context = agencyFacadeContext();
    const agency = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });
    const { slug: _slug, ...withoutSlug } = resolvedAgencySpec;
    agency.merge(withoutSlug);

    await expect(agency.value("slug")).resolves.toBe("minnesota-state-patrol");
  });

  test("LicensingAuthorityFacade resolves its canonical id from the ledger, minting when absent", async () => {
    const sourceNameToCanonicalIds = licensingSourceNameToCanonicalIds({
      tcole: { canonicalId: "authority-canonical-id" },
    });
    const context = licensingContext(sourceNameToCanonicalIds);

    // Find: an id already in the SourceNameToCanonicalId ledger is reused.
    const seeded = context.licensingAuthorityFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "tcole",
      spec: {
        name: "Texas Commission on Law Enforcement",
        location_path_id: "tx",
      },
    });
    await expect(seeded.value("id")).resolves.toBe("authority-canonical-id");

    // Create: an absent source id mints a stable cuid2 and persists it back to
    // the ledger (find-or-create).
    const minted = context.licensingAuthorityFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "unseeded-authority",
      spec: { name: "New Authority", location_path_id: "tx" },
    });
    const mintedId = await minted.value("id");
    expect(mintedId).not.toBe("authority-canonical-id");
    expect(mintedId).toMatch(/^[0-9a-z]+$/);
    expect(
      sourceNameToCanonicalIds.licensingAuthorities?.["unseeded-authority"]
        ?.canonicalId,
    ).toBe(mintedId);
  });

  test("LicensingAuthorityFacade canonical-id resolver mints and durably persists a new id", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "la-ledger-"));
    const context = new DataContext({
      client: new EmptyClient(),
      rows,
      commandName: "command-name",
      databaseLocationPaths: [txLocationPath],
      databaseLocationPathAliases: [],
      sourceNameToCanonicalIds: licensingSourceNameToCanonicalIds({}),
      // The resolver is the sole owner of LicensingAuthority identity: it mints
      // AND persists, with no earlier minting stage involved.
      persistSourceNameToCanonicalIds: (namespace, mappings) =>
        persistSourceNameToCanonicalIds(namespace, mappings, { rootDir }),
    });

    const facade = context.licensingAuthorityFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "tcole",
      spec: {
        name: "Texas Commission on Law Enforcement",
        location_path_id: "tx",
      },
    });
    const mintedId = await facade.value("id");

    // Persisted to disk by the resolver alone — a fresh load returns it.
    const reloaded = await loadSourceNameToCanonicalIds("gov.tx.tcole", {
      rootDir,
    });
    expect(reloaded.licensingAuthorities?.tcole).toEqual({
      kind: "LicensingAuthority",
      canonicalId: mintedId,
    });
  });

  test("LicensingAuthorityFacade auto-loads its current DB row and emits an update, not a create", async () => {
    const context = new DataContext({
      client: new EmptyClient(),
      rows,
      commandName: "command-name",
      databaseLocationPaths: [txLocationPath],
      databaseLocationPathAliases: [],
      sourceNameToCanonicalIds: licensingSourceNameToCanonicalIds({
        tcole: { canonicalId: "authority-canonical-id" },
      }),
      // Mirrors databaseAgencies: the facade loads `current` from here after it
      // resolves the canonical id — no per-record special-casing at the caller.
      databaseLicensingAuthorities: [
        {
          id: "authority-canonical-id",
          name: "Texas Commission on Law Enforcement",
          abbreviation: "TCOLE",
          website: "https://www.tcole.texas.gov",
          location_path_id: "tx-location-path-id",
        },
      ],
    });

    const facade = context.licensingAuthorityFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "tcole",
      // No input.current — the facade auto-loads it from the database map.
      spec: {
        name: "Texas Commission on Law Enforcement",
        abbreviation: "TCOLE",
        website: "https://tcole.texas.gov",
        location_path_id: "tx",
      },
    });

    expect(await facade.toMutation()).toMatchObject({
      kind: "LicensingAuthorityUpdate",
      metadata: { namespace: "gov.tx.tcole", name: "tcole" },
      spec: {
        operations: [
          { action: "check", path: "name" },
          { action: "check", path: "abbreviation" },
          {
            action: "set",
            path: "website",
            from: "https://www.tcole.texas.gov",
            to: "https://tcole.texas.gov",
          },
          {
            action: "check",
            path: "location_path_id",
            value: "tx-location-path-id",
          },
        ],
      },
    });
  });

  test("LicensingAuthorityFacade.toMutation emits a LicensingAuthorityCreate with the resolved location", async () => {
    const context = licensingContext(
      licensingSourceNameToCanonicalIds({
        tcole: { canonicalId: "authority-canonical-id" },
      }),
    );
    context.licensingAuthorityFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "tcole",
      spec: {
        name: "Texas Commission on Law Enforcement",
        abbreviation: "TCOLE",
        website: "https://www.tcole.texas.gov",
        // Namespace-local state value resolved to a canonical location_path.
        location_path_id: "tx",
      },
    });

    const envelope = await context.toDatabaseMutations({
      namespace: "gov.tx.tcole",
      name: "command-name",
    });

    expect(envelope.spec.mutations).toMatchObject([
      {
        kind: "LicensingAuthorityCreate",
        name: "tcole",
        spec: {
          id: "authority-canonical-id",
          name: "Texas Commission on Law Enforcement",
          abbreviation: "TCOLE",
          website: "https://www.tcole.texas.gov",
          location_path_id: "tx-location-path-id",
        },
      },
    ]);
    // Facade entities are counted exactly like Agency, from the emitted envelope.
    expect(
      countDatabaseMutations(envelope.spec.mutations).recordsByEntityType
        .LicensingAuthority,
    ).toBe(1);
  });

  test("LicensingAuthorityFacade.toMutation emits a LicensingAuthorityUpdate diff when a current row exists", async () => {
    const context = licensingContext(
      licensingSourceNameToCanonicalIds({
        tcole: { canonicalId: "authority-canonical-id" },
      }),
    );
    const facade = context.licensingAuthorityFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "tcole",
      current: {
        id: "authority-canonical-id",
        name: "Texas Commission on Law Enforcement",
        abbreviation: "TCOLE",
        website: "https://www.tcole.texas.gov",
        location_path_id: "tx-location-path-id",
      },
      spec: {
        name: "Texas Commission on Law Enforcement",
        abbreviation: "TCOLE",
        website: "https://tcole.texas.gov",
        location_path_id: "tx",
      },
    });

    expect(await facade.toMutation()).toMatchObject({
      kind: "LicensingAuthorityUpdate",
      metadata: { namespace: "gov.tx.tcole", name: "tcole" },
      spec: {
        operations: [
          { action: "check", path: "name" },
          { action: "check", path: "abbreviation" },
          {
            action: "set",
            path: "website",
            from: "https://www.tcole.texas.gov",
            to: "https://tcole.texas.gov",
          },
          {
            action: "check",
            path: "location_path_id",
            value: "tx-location-path-id",
          },
        ],
      },
    });
  });

  test("LicensingAuthorityFacade location resolver fails resolve-or-fail when the state does not resolve", async () => {
    const context = licensingContext(
      licensingSourceNameToCanonicalIds({
        other: { canonicalId: "authority-canonical-id" },
      }),
    );
    const facade = context.licensingAuthorityFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "other",
      spec: { name: "Unknown Authority", location_path_id: "zz" },
    });

    await expect(facade.toMutation()).rejects.toThrow(
      'source value "zz" does not match an imported location_path at /zz/',
    );
  });

  function licenseClusterContext(options?: {
    licenses?: SourceNameToCanonicalIds["licenses"];
    licenseActions?: SourceNameToCanonicalIds["licenseActions"];
    databaseLicenses?: Record<string, unknown>[];
    databaseLicenseActions?: Record<string, unknown>[];
    persistSourceNameToCanonicalIds?: (
      namespace: string,
      mappings: SourceNameToCanonicalIds,
    ) => Promise<void>;
  }): DataContext {
    return new DataContext({
      client: new EmptyClient(),
      rows,
      commandName: "command-name",
      databaseLocationPaths: [txLocationPath],
      databaseLocationPathAliases: [],
      sourceNameToCanonicalIds: {
        agencies: {},
        personnel: { "1000038": { canonicalId: "personnel-canonical-id" } },
        agencyPersonnel: {},
        locationPaths: {},
        licensingAuthorities: { tcole: { canonicalId: "authority-canonical-id" } },
        licenses: options?.licenses ?? {},
        licenseActions: options?.licenseActions ?? {},
      },
      ...(options?.databaseLicenses === undefined
        ? {}
        : { databaseLicenses: options.databaseLicenses }),
      ...(options?.databaseLicenseActions === undefined
        ? {}
        : { databaseLicenseActions: options.databaseLicenseActions }),
      ...(options?.persistSourceNameToCanonicalIds === undefined
        ? {}
        : {
            persistSourceNameToCanonicalIds:
              options.persistSourceNameToCanonicalIds,
          }),
    });
  }

  function registerLicenseCluster(context: DataContext): void {
    // Dependency order (ADR 0016 #9): the referenced Personnel and
    // LicensingAuthority facades are registered before the License that finds
    // them, and the License before the LicenseAction that finds it.
    context.personnelFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "1000038",
      spec: { first_name: "Marc", last_name: "Denney" },
    });
    context.licensingAuthorityFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "tcole",
      spec: {
        name: "Texas Commission on Law Enforcement",
        location_path_id: "tx",
      },
    });
    context.licenseFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "1000038|Peace Officer License",
      spec: {
        officer_id: "1000038",
        license_type: "Peace Officer License",
        status: null,
        first_awarded: "1994-06-16",
        issued_by_authority_id: "tcole",
      },
    });
  }

  test("LicenseFacade emits a LicenseCreate resolving its officer and authority foreign keys", async () => {
    const context = licenseClusterContext({
      licenses: {
        "1000038|Peace Officer License": { canonicalId: "license-canonical-id" },
      },
    });
    registerLicenseCluster(context);
    const facade = context.licenseFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "1000038|Peace Officer License",
    });

    expect(await facade.toMutation()).toMatchObject({
      kind: "LicenseCreate",
      metadata: {
        namespace: "gov.tx.tcole",
        name: "1000038|Peace Officer License",
      },
      spec: {
        id: "license-canonical-id",
        officer_id: "personnel-canonical-id",
        license_type: "Peace Officer License",
        status: null,
        first_awarded: "1994-06-16",
        issued_by_authority_id: "authority-canonical-id",
      },
    });
  });

  test("LicenseFacade emits a LicenseUpdate diff when a current DB row exists", async () => {
    const context = licenseClusterContext({
      licenses: {
        "1000038|Peace Officer License": { canonicalId: "license-canonical-id" },
      },
      databaseLicenses: [
        {
          id: "license-canonical-id",
          officer_id: "personnel-canonical-id",
          license_type: "Peace Officer License",
          status: null,
          first_awarded: "1990-01-01",
          issued_by_authority_id: "authority-canonical-id",
        },
      ],
    });
    registerLicenseCluster(context);
    const facade = context.licenseFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "1000038|Peace Officer License",
    });

    expect(await facade.toMutation()).toMatchObject({
      kind: "LicenseUpdate",
      metadata: { namespace: "gov.tx.tcole", name: "1000038|Peace Officer License" },
      spec: {
        operations: [
          { action: "check", path: "officer_id", value: "personnel-canonical-id" },
          { action: "check", path: "license_type" },
          { action: "check", path: "status" },
          {
            action: "set",
            path: "first_awarded",
            from: "1990-01-01",
            to: "1994-06-16",
          },
          {
            action: "check",
            path: "issued_by_authority_id",
            value: "authority-canonical-id",
          },
        ],
      },
    });
  });

  test("LicenseFacade officer foreign-key find fails fast and loud on a forward reference", async () => {
    const context = licenseClusterContext({
      licenses: {
        "1000038|Peace Officer License": { canonicalId: "license-canonical-id" },
      },
    });
    // Register the authority but NOT the referenced Personnel facade.
    context.licensingAuthorityFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "tcole",
      spec: {
        name: "Texas Commission on Law Enforcement",
        location_path_id: "tx",
      },
    });
    const facade = context.licenseFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "1000038|Peace Officer License",
      spec: {
        officer_id: "1000038",
        license_type: "Peace Officer License",
        status: null,
        first_awarded: "1994-06-16",
        issued_by_authority_id: "tcole",
      },
    });

    await expect(facade.toMutation()).rejects.toThrow(
      /no Personnel facade was emitted for source id "1000038" \(forward reference/,
    );
  });

  test("LicenseFacade canonical-id resolver mints and durably persists a new id", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "license-ledger-"));
    const context = licenseClusterContext({
      persistSourceNameToCanonicalIds: (namespace, mappings) =>
        persistSourceNameToCanonicalIds(namespace, mappings, { rootDir }),
    });
    const facade = context.licenseFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "1000038|Peace Officer License",
      spec: {
        officer_id: "1000038",
        license_type: "Peace Officer License",
        issued_by_authority_id: "tcole",
      },
    });
    const mintedId = await facade.value("id");

    const reloaded = await loadSourceNameToCanonicalIds("gov.tx.tcole", {
      rootDir,
    });
    expect(reloaded.licenses?.["1000038|Peace Officer License"]).toEqual({
      kind: "License",
      canonicalId: mintedId,
    });
  });

  test("LicenseActionFacade emits a LicenseActionCreate resolving its license foreign key", async () => {
    const context = licenseClusterContext({
      licenses: {
        "1000038|Peace Officer License": { canonicalId: "license-canonical-id" },
      },
      licenseActions: {
        "1000038|Peace Officer License|Issued|1994-06-16": {
          canonicalId: "license-action-canonical-id",
        },
      },
    });
    registerLicenseCluster(context);
    const facade = context.licenseActionFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "1000038|Peace Officer License|Issued|1994-06-16",
      spec: {
        license_id: "1000038|Peace Officer License",
        action: "Issued",
        action_date: "1994-06-16",
        status: "Active",
      },
    });

    expect(await facade.toMutation()).toMatchObject({
      kind: "LicenseActionCreate",
      metadata: {
        namespace: "gov.tx.tcole",
        name: "1000038|Peace Officer License|Issued|1994-06-16",
      },
      spec: {
        id: "license-action-canonical-id",
        license_id: "license-canonical-id",
        action: "Issued",
        action_date: "1994-06-16",
        status: "Active",
      },
    });
  });

  test("LicenseActionFacade license foreign-key find fails fast and loud on a forward reference", async () => {
    const context = licenseClusterContext({
      licenseActions: {
        "1000038|Peace Officer License|Issued|1994-06-16": {
          canonicalId: "license-action-canonical-id",
        },
      },
    });
    // The referenced License facade is never registered.
    const facade = context.licenseActionFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "1000038|Peace Officer License|Issued|1994-06-16",
      spec: {
        license_id: "1000038|Peace Officer License",
        action: "Issued",
        action_date: "1994-06-16",
        status: "Active",
      },
    });

    await expect(facade.toMutation()).rejects.toThrow(
      /no License facade was emitted for source id "1000038\|Peace Officer License" \(forward reference/,
    );
  });
});

describe("PersonnelFacade", () => {
  function emptyPersonnel(): SourceNameToCanonicalIds {
    return {
      agencies: {},
      personnel: {},
      agencyPersonnel: {},
      locationPaths: {},
      licensingAuthorities: {},
      licenses: {},
      licenseActions: {},
    };
  }

  function personnelContext(options?: {
    client?: DatabaseClient;
    personnel?: SourceNameToCanonicalIds["personnel"];
    databaseOfficers?: Record<string, unknown>[];
    persistSourceNameToCanonicalIds?: (
      namespace: string,
      mappings: SourceNameToCanonicalIds,
    ) => Promise<void>;
  }): DataContext {
    return new DataContext({
      client: options?.client ?? new EmptyClient(),
      rows,
      commandName: "command-name",
      sourceNameToCanonicalIds: {
        ...emptyPersonnel(),
        personnel: options?.personnel ?? {},
      },
      ...(options?.databaseOfficers === undefined
        ? {}
        : { databaseOfficers: options.databaseOfficers }),
      ...(options?.persistSourceNameToCanonicalIds === undefined
        ? {}
        : {
            persistSourceNameToCanonicalIds:
              options.persistSourceNameToCanonicalIds,
          }),
    });
  }

  test("finds a seeded canonical id and emits a PersonnelCreate with a generated slug", async () => {
    const context = personnelContext({
      personnel: { "1000038": { canonicalId: "personnel-canonical-id" } },
    });
    const facade = context.personnelFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "1000038",
      spec: { first_name: "Marc", last_name: "Denney" },
    });

    expect(await facade.toMutation()).toMatchObject({
      kind: "PersonnelCreate",
      metadata: { namespace: "gov.tx.tcole", name: "1000038" },
      spec: {
        id: "personnel-canonical-id",
        first_name: "Marc",
        last_name: "Denney",
        middle_name: null,
        prefix: null,
        suffix: null,
        slug: "marc-denney-icalid",
      },
    });
  });

  test("mints and durably persists a canonical id when none is seeded (id stability)", async () => {
    const persisted: {
      namespace: string;
      mappings: SourceNameToCanonicalIds;
    }[] = [];
    const context = personnelContext({
      persistSourceNameToCanonicalIds: async (namespace, mappings) => {
        persisted.push({
          namespace,
          mappings: JSON.parse(JSON.stringify(mappings)),
        });
      },
    });
    const facade = context.personnelFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "new-officer-source",
      spec: { first_name: "New", last_name: "Officer" },
    });

    const mutation = await facade.toMutation();
    const mintedId = (mutation.spec as { id: string }).id;
    expect(mintedId).toMatch(/^[a-z0-9]{20,}$/);
    // value("id") is memoized: the FK-find and toMutation see the same id.
    expect(await facade.value("id")).toBe(mintedId);
    // The mint is durably persisted to the ledger under the source id.
    expect(persisted.length).toBeGreaterThan(0);
    const last = persisted.at(-1)!;
    expect(last.namespace).toBe("gov.tx.tcole");
    expect(last.mappings.personnel["new-officer-source"]).toEqual({
      kind: "Personnel",
      canonicalId: mintedId,
    });
  });

  test("uses an explicitly supplied slug as-is", async () => {
    const context = personnelContext({
      personnel: { "1000038": { canonicalId: "personnel-canonical-id" } },
    });
    const facade = context.personnelFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "1000038",
      spec: { first_name: "Marc", last_name: "Denney", slug: "custom-slug" },
    });

    expect(await facade.toMutation()).toMatchObject({
      kind: "PersonnelCreate",
      spec: { slug: "custom-slug" },
    });
  });

  test("reuses the existing database row's slug for stability and emits an update", async () => {
    const context = personnelContext({
      personnel: { "1000038": { canonicalId: "personnel-canonical-id" } },
      databaseOfficers: [
        {
          id: "personnel-canonical-id",
          first_name: "Marc",
          last_name: "Denney",
          middle_name: null,
          prefix: null,
          suffix: null,
          slug: "legacy-slug",
        },
      ],
    });
    const facade = context.personnelFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "1000038",
      // A corrected first name must not change the slug.
      spec: { first_name: "Marcus", last_name: "Denney" },
    });

    expect(await facade.toMutation()).toMatchObject({
      kind: "PersonnelUpdate",
      spec: {
        operations: expect.arrayContaining([
          expect.objectContaining({
            action: "check",
            path: "slug",
            value: "legacy-slug",
          }),
          expect.objectContaining({
            action: "set",
            path: "first_name",
            from: "Marc",
            to: "Marcus",
          }),
        ]),
      },
    });
  });

  test("slug uniqueness disambiguates against another record planned in the same command", async () => {
    // Two officers with the same name whose canonical ids share the last six
    // alphanumerics collide on the generated base slug (level 1: current command).
    const context = personnelContext({
      personnel: {
        p1: { canonicalId: "officer-aaaaaa" },
        p2: { canonicalId: "deputy-aaaaaa" },
      },
    });
    const first = context.personnelFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "p1",
      spec: { first_name: "John", last_name: "Doe" },
    });
    const second = context.personnelFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "p2",
      spec: { first_name: "John", last_name: "Doe" },
    });

    expect(await first.value("slug")).toBe("john-doe-aaaaaa");
    expect(await second.value("slug")).toBe("john-doe-aaaaaa-2");
  });

  test("slug uniqueness disambiguates against a conflicting database row (level 3)", async () => {
    class OfficerSlugClient extends EmptyClient {
      async query(
        text = "",
        values: readonly unknown[] = [],
      ): Promise<{ rows: Record<string, unknown>[] }> {
        if (/select id, slug from public\.officers where slug = any/i.test(text)) {
          const slug = (values[0] as string[] | undefined)?.[0];
          if (slug === "marc-denney-icalid") {
            return { rows: [{ id: "someone-else", slug }] };
          }
        }
        return { rows: [] };
      }
    }
    const context = personnelContext({
      client: new OfficerSlugClient(),
      personnel: { "1000038": { canonicalId: "personnel-canonical-id" } },
    });
    const facade = context.personnelFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "1000038",
      spec: { first_name: "Marc", last_name: "Denney" },
    });

    expect(await facade.value("slug")).toBe("marc-denney-icalid-2");
  });
});

describe("AgencyPersonnelFacade", () => {
  function agencyPersonnelContext(options?: {
    agencies?: SourceNameToCanonicalIds["agencies"];
    personnel?: SourceNameToCanonicalIds["personnel"];
    agencyPersonnel?: SourceNameToCanonicalIds["agencyPersonnel"];
    licenses?: SourceNameToCanonicalIds["licenses"];
    databaseAgencyPersonnel?: Record<string, unknown>[];
  }): DataContext {
    return new DataContext({
      client: new EmptyClient(),
      rows,
      commandName: "command-name",
      sourceNameToCanonicalIds: {
        agencies: options?.agencies ?? {},
        personnel: options?.personnel ?? {},
        agencyPersonnel: options?.agencyPersonnel ?? {},
        locationPaths: {},
        licensingAuthorities: {},
        licenses: options?.licenses ?? {},
        licenseActions: {},
      },
      ...(options?.databaseAgencyPersonnel === undefined
        ? {}
        : { databaseAgencyPersonnel: options.databaseAgencyPersonnel }),
    });
  }

  // Register the FK targets (Agency / Personnel / License facades) that an
  // AgencyPersonnel record references, so each FK find (ADR 0016 #4/#9) resolves.
  function registerForeignKeyTargets(context: DataContext): void {
    context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "agency-source",
    });
    context.personnelFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "personnel-source",
      spec: { first_name: "Marc", last_name: "Denney" },
    });
    context.licenseFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "license-source",
      spec: {
        officer_id: "personnel-source",
        license_type: "Peace Officer License",
        issued_by_authority_id: "tcole",
      },
    });
  }

  const foreignKeyLedger = {
    agencies: { "agency-source": { canonicalId: "agency-canonical-id" } },
    personnel: { "personnel-source": { canonicalId: "personnel-canonical-id" } },
    licenses: { "license-source": { canonicalId: "license-canonical-id" } },
  };

  test("resolves its agency, personnel, and license foreign keys to canonical ids", async () => {
    const context = agencyPersonnelContext(foreignKeyLedger);
    registerForeignKeyTargets(context);
    const facade = context.agencyPersonnelFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "ap-source",
      spec: {
        agency_id: "agency-source",
        personnel_id: "personnel-source",
        license_id: "license-source",
        title: "Peace Officer",
        start_date: "2020-01-01",
        end_date: null,
        badge_number: "49112",
      },
    });

    expect(await facade.toMutation()).toMatchObject({
      kind: "AgencyPersonnelCreate",
      metadata: { namespace: "mn-post", name: "ap-source" },
      spec: {
        agency_id: "agency-canonical-id",
        personnel_id: "personnel-canonical-id",
        license_id: "license-canonical-id",
        title: "Peace Officer",
        start_date: "2020-01-01",
        end_date: null,
        badge_number: "49112",
      },
    });
  });

  test("keeps a null license_id null (nullable foreign key)", async () => {
    const context = agencyPersonnelContext(foreignKeyLedger);
    registerForeignKeyTargets(context);
    const facade = context.agencyPersonnelFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "ap-source",
      spec: {
        agency_id: "agency-source",
        personnel_id: "personnel-source",
        // no license_id
        title: "Peace Officer",
        start_date: "2020-01-01",
      },
    });

    expect(await facade.value("license_id")).toBeNull();
    expect(await facade.toMutation()).toMatchObject({
      kind: "AgencyPersonnelCreate",
      spec: { license_id: null },
    });
  });

  test("emits an AgencyPersonnelUpdate diff when a current DB row exists", async () => {
    const context = agencyPersonnelContext({
      ...foreignKeyLedger,
      agencyPersonnel: {
        "ap-source": { canonicalId: "agency-personnel-canonical-id" },
      },
      databaseAgencyPersonnel: [
        {
          id: "agency-personnel-canonical-id",
          agency_id: "agency-canonical-id",
          personnel_id: "personnel-canonical-id",
          license_id: "license-canonical-id",
          title: "Deputy",
          start_date: "2020-01-01",
          end_date: null,
          badge_number: "49112",
        },
      ],
    });
    registerForeignKeyTargets(context);
    const facade = context.agencyPersonnelFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "ap-source",
      canonicalId: "agency-personnel-canonical-id",
      spec: {
        agency_id: "agency-source",
        personnel_id: "personnel-source",
        license_id: "license-source",
        title: "Peace Officer",
        start_date: "2020-01-01",
        end_date: null,
        badge_number: "49112",
      },
    });

    expect(await facade.toMutation()).toMatchObject({
      kind: "AgencyPersonnelUpdate",
      spec: {
        operations: expect.arrayContaining([
          expect.objectContaining({
            action: "set",
            path: "title",
            from: "Deputy",
            to: "Peace Officer",
          }),
          expect.objectContaining({
            action: "check",
            path: "agency_id",
            value: "agency-canonical-id",
          }),
        ]),
      },
    });
  });

  test("agency foreign-key find fails fast and loud on a forward reference", async () => {
    const context = agencyPersonnelContext(foreignKeyLedger);
    // Register Personnel and License but NOT the referenced Agency facade.
    context.personnelFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "personnel-source",
      spec: { first_name: "Marc", last_name: "Denney" },
    });
    const facade = context.agencyPersonnelFromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "ap-source",
      spec: {
        agency_id: "agency-source",
        personnel_id: "personnel-source",
        title: "Peace Officer",
        start_date: "2020-01-01",
      },
    });

    await expect(facade.toMutation()).rejects.toThrow(
      /no Agency facade was emitted for source id "agency-source" \(forward reference/,
    );
  });
});
