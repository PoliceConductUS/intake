import { LocationPathSpec } from "../../../shared/io/generated/entity-specs.js";
import type { ArtifactsEnvelope } from "../../../shared/io/Artifacts.js";
import {
  INTAKE_API_VERSION,
  sourceNameForImportRecord,
} from "../../../shared/io/import-types.js";
import type { DatabaseClient } from "../../database/index.js";
import {
  readLocationPathAliasByPath,
  readLocationPathById,
  readLocationPathByPath,
  readPlaceLocationPathsContainingPoint,
} from "../../database/location-paths.js";
import type { ImportOperation, ImportOperations } from "./operations.js";
import {
  type AgencyOfficerRow,
  type AgencyRow,
  type ImportRows,
  type LocationPathAliasRow,
  type LocationPathRow,
  type OfficerRow,
  type ResolvedProperties,
} from "./transform.js";
import {
  AgencyFieldResolutionError,
  type AgencyFieldResolutionOptions,
  type AgencyResolvedPropertyUpdate,
  missingResolvableAgencyFields,
  resolveAgencyMissingFields,
  resolveCachedAgencyLocationPath,
} from "./agency-field-resolution.js";
import {
  AgencyCreate,
  type AgencyCreateEnvelope,
} from "./io/generated-mutations/AgencyCreate.js";
import {
  AgencyUpdate,
  type AgencyUpdateEnvelope,
} from "./io/generated-mutations/AgencyUpdate.js";
import {
  AgencyPersonnelCreate,
  type AgencyPersonnelCreateEnvelope,
} from "./io/generated-mutations/AgencyPersonnelCreate.js";
import {
  AgencyPersonnelUpdate,
  type AgencyPersonnelUpdateEnvelope,
} from "./io/generated-mutations/AgencyPersonnelUpdate.js";
import {
  PersonnelCreate,
  type PersonnelCreateEnvelope,
} from "./io/generated-mutations/PersonnelCreate.js";
import {
  PersonnelUpdate,
  type PersonnelUpdateEnvelope,
} from "./io/generated-mutations/PersonnelUpdate.js";
import {
  DatabaseMutations,
  type DatabaseMutationItem,
  type DatabaseMutationsEnvelope,
} from "./io/DatabaseMutations.js";
import type { SourceNameToCanonicalIds } from "../../state/source-name-to-canonical-id/index.js";

type DataContextLogger = {
  debug?(object: Record<string, unknown>, message: string): void;
};

export type ImportEntityType = "agency" | "officer" | "agencyOfficer";

export type ImportEntityRow = {
  agency: AgencyRow;
  officer: OfficerRow;
  agencyOfficer: AgencyOfficerRow;
};

export type ImportEntityResolver<
  EntityType extends ImportEntityType = ImportEntityType,
> = (row: ImportEntityRow[EntityType], context: DataContext) => Promise<void>;

export type DataContextOptions = {
  client?: DatabaseClient;
  rows: ImportRows;
  logger?: DataContextLogger;
  databaseLocationPaths?: LocationPathRow[];
  databaseLocationPathAliases?: LocationPathAliasRow[];
  operations?: ImportOperations;
  entityResolvers?: Partial<{
    [EntityType in ImportEntityType]: ImportEntityResolver<EntityType>;
  }>;
  loadLocationPathById?: (
    locationPathId: string,
  ) => Promise<LocationPathRow | undefined>;
  loadLocationPathByPath?: (
    locationPathPath: string,
  ) => Promise<LocationPathRow | undefined>;
  resolveAddress?: (
    input: AddressResolutionRequest,
  ) => Promise<AddressResolution | undefined>;
  resolveAdministrativeArea?: (
    input: LocationAdministrativeAreaRequest,
  ) => Promise<LocationAdministrativeAreaResolution | undefined>;
  agencyFieldResolutionOptions?: AgencyFieldResolutionOptions;
  resolvedProperties?: ResolvedProperties;
  commandName?: string;
  sourceNameToCanonicalIds?: SourceNameToCanonicalIds;
  databaseAgencies?: Record<string, unknown>[];
};

type SourceRecordContext = {
  apiVersion: typeof INTAKE_API_VERSION;
  namespace: string;
  name: string;
  canonicalId?: string;
  commandName?: string;
  current?: Record<string, unknown>;
  spec?: Record<string, unknown>;
};

type FacadeSource = {
  namespace: string;
  name: string;
  canonicalId?: string;
  commandName?: string;
};

type FacadeEntry<TFacade> = {
  source: FacadeSource;
  facade: TFacade;
};

export type DatabaseMutationsMetadataInput = {
  namespace: string;
  name: string;
  sourceArtifactsName?: string;
  sourceArtifactsPath?: string;
  sourceArtifactsDigest?: string;
  artifactMutation?: { path: string; digest: string };
  databaseSchema?: Record<string, unknown>;
};

type OwnedColumnsMetadata = {
  agency?: ImportRows["ownedColumns"]["agencies"][string];
  personnel?: ImportRows["ownedColumns"]["officers"][string];
  agencyPersonnel?: ImportRows["ownedColumns"]["agencyOfficers"][string];
};

function validateSourceRecordContext(input: SourceRecordContext): void {
  if (input.apiVersion !== INTAKE_API_VERSION) {
    throw new Error(
      `Unsupported source apiVersion: ${String(input.apiVersion)}`,
    );
  }
  if (valueAsString(input.namespace) === undefined) {
    throw new Error("Source record metadata.namespace is required.");
  }
  if (valueAsString(input.name) === undefined) {
    throw new Error("Source record metadata.name is required.");
  }
}

export class AgencyFacade {
  private static readonly kind = "Agency";
  private readonly current?: Record<string, unknown>;
  private readonly spec: Record<string, unknown>;

  constructor(current?: Record<string, unknown>) {
    this.current = current;
    this.spec = {};
  }

  merge(spec: Record<string, unknown>): void {
    Object.assign(this.spec, spec);
  }

  string(property: string): string | undefined {
    return valueAsString(this.value(property));
  }

  number(property: string): number | undefined {
    const value = this.value(property);
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  }

  toMutation(
    sourceContext: FacadeSource,
  ): AgencyCreateEnvelope | AgencyUpdateEnvelope {
    const canonicalId = valueAsString(sourceContext.canonicalId);
    if (canonicalId === undefined) {
      throw new Error(
        `Cannot create agency mutation for ${sourceContext.namespace}/${sourceContext.name} without canonical ID.`,
      );
    }

    if (this.current === undefined) {
      return AgencyCreate.new({
        metadata: {
          namespace: sourceContext.namespace,
          name: sourceContext.name,
        },
        spec: {
          id: canonicalId,
          ...this.spec,
        } as Parameters<typeof AgencyCreate.new>[0]["spec"],
      });
    }

    const commandName = valueAsString(sourceContext.commandName);
    if (commandName === undefined) {
      throw new Error(
        `Cannot create agency update for ${sourceContext.namespace}/${sourceContext.name} without command name.`,
      );
    }

    const source = {
      namespace: sourceContext.namespace,
      command: { name: commandName },
      kind: AgencyFacade.kind,
      name: sourceContext.name,
    };
    const operations = Object.entries(this.spec)
      .filter(([path]) => path !== "id")
      .map(([path, to]) => {
        const from = this.current?.[path];
        if (Object.is(from, to)) {
          return {
            action: "check" as const,
            path,
            value: to,
            reason: `Expected existing ${AgencyFacade.kind} ${path}.`,
            source,
          };
        }

        return {
          action: "set" as const,
          path,
          from,
          to,
          reason: `Set ${AgencyFacade.kind} ${path}.`,
          source,
        };
      });

    return AgencyUpdate.new({
      metadata: {
        namespace: sourceContext.namespace,
        name: sourceContext.name,
      },
      spec: { operations },
    });
  }

  private value(property: string): unknown {
    return property.split(".").reduce<unknown>((current, pathPart) => {
      if (
        typeof current !== "object" ||
        current === null ||
        Array.isArray(current)
      ) {
        return undefined;
      }
      return (current as Record<string, unknown>)[pathPart];
    }, this.spec);
  }
}

export class PersonnelFacade {
  private static readonly kind = "Personnel";
  private readonly current?: Record<string, unknown>;
  private readonly spec: Record<string, unknown>;

  constructor(current?: Record<string, unknown>) {
    this.current = current;
    this.spec = {};
  }

  merge(spec: Record<string, unknown>): void {
    Object.assign(this.spec, spec);
  }

  toMutation(
    sourceContext: FacadeSource,
  ): PersonnelCreateEnvelope | PersonnelUpdateEnvelope {
    const canonicalId = valueAsString(sourceContext.canonicalId);
    if (canonicalId === undefined) {
      throw new Error(
        `Cannot create personnel mutation for ${sourceContext.namespace}/${sourceContext.name} without canonical ID.`,
      );
    }

    if (this.current === undefined) {
      return PersonnelCreate.new({
        metadata: {
          namespace: sourceContext.namespace,
          name: sourceContext.name,
        },
        spec: {
          id: canonicalId,
          ...this.spec,
        } as Parameters<typeof PersonnelCreate.new>[0]["spec"],
      });
    }

    const commandName = valueAsString(sourceContext.commandName);
    if (commandName === undefined) {
      throw new Error(
        `Cannot create personnel update for ${sourceContext.namespace}/${sourceContext.name} without command name.`,
      );
    }

    const source = {
      namespace: sourceContext.namespace,
      command: { name: commandName },
      kind: PersonnelFacade.kind,
      name: sourceContext.name,
    };
    const operations = Object.entries(this.spec)
      .filter(([path]) => path !== "id")
      .map(([path, to]) => {
        const from = this.current?.[path];
        if (Object.is(from, to)) {
          return {
            action: "check" as const,
            path,
            value: to,
            reason: `Expected existing ${PersonnelFacade.kind} ${path}.`,
            source,
          };
        }

        return {
          action: "set" as const,
          path,
          from,
          to,
          reason: `Set ${PersonnelFacade.kind} ${path}.`,
          source,
        };
      });

    return PersonnelUpdate.new({
      metadata: {
        namespace: sourceContext.namespace,
        name: sourceContext.name,
      },
      spec: { operations },
    });
  }
}

export class AgencyPersonnelFacade {
  private static readonly kind = "AgencyPersonnel";
  private readonly current?: Record<string, unknown>;
  private readonly spec: Record<string, unknown>;

  constructor(current?: Record<string, unknown>) {
    this.current = current;
    this.spec = {};
  }

  merge(spec: Record<string, unknown>): void {
    Object.assign(this.spec, spec);
  }

  toMutation(
    sourceContext: FacadeSource,
  ): AgencyPersonnelCreateEnvelope | AgencyPersonnelUpdateEnvelope {
    const canonicalId = valueAsString(sourceContext.canonicalId);
    if (canonicalId === undefined) {
      throw new Error(
        `Cannot create agency-personnel mutation for ${sourceContext.namespace}/${sourceContext.name} without canonical ID.`,
      );
    }

    if (this.current === undefined) {
      return AgencyPersonnelCreate.new({
        metadata: {
          namespace: sourceContext.namespace,
          name: sourceContext.name,
        },
        spec: {
          id: canonicalId,
          ...this.spec,
        } as Parameters<typeof AgencyPersonnelCreate.new>[0]["spec"],
      });
    }

    const commandName = valueAsString(sourceContext.commandName);
    if (commandName === undefined) {
      throw new Error(
        `Cannot create agency-personnel update for ${sourceContext.namespace}/${sourceContext.name} without command name.`,
      );
    }

    const source = {
      namespace: sourceContext.namespace,
      command: { name: commandName },
      kind: AgencyPersonnelFacade.kind,
      name: sourceContext.name,
    };
    const operations = Object.entries(this.spec)
      .filter(([path]) => path !== "id")
      .map(([path, to]) => {
        const from = this.current?.[path];
        if (Object.is(from, to)) {
          return {
            action: "check" as const,
            path,
            value: to,
            reason: `Expected existing ${AgencyPersonnelFacade.kind} ${path}.`,
            source,
          };
        }

        return {
          action: "set" as const,
          path,
          from,
          to,
          reason: `Set ${AgencyPersonnelFacade.kind} ${path}.`,
          source,
        };
      });

    return AgencyPersonnelUpdate.new({
      metadata: {
        namespace: sourceContext.namespace,
        name: sourceContext.name,
      },
      spec: { operations },
    });
  }
}

export type LocationAdministrativeAreaRequest = {
  address?: string;
  state: string;
  placeName: string;
  placeSlug: string;
  zipCode?: string;
};

export type LocationAdministrativeAreaResolution = {
  administrativeAreaName: string;
  administrativeAreaSlug?: string;
};

export type AddressResolutionRequest = {
  entityType: string;
  entityId: string;
  sourceName?: string;
  name?: string;
  address: string;
  place: string;
  state: string;
  zipCode: string;
  administrativeAreaName?: string;
  administrativeAreaSlug?: string;
  latitude?: number;
  longitude?: number;
};

export type AddressResolution = {
  latitude: number;
  longitude: number;
};

export type LocationResolution = {
  locationPathId: string;
  addressLatitude: number;
  addressLongitude: number;
};

export type ResolveAddressInput = {
  entityType: string;
  entityId: string;
  state?: string;
  place?: string;
  zipCode?: string;
  address?: string;
  administrativeAreaName?: string;
  administrativeAreaSlug?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
  sourceName?: string;
  preferredLocationPathId?: string;
};

export type CanonicalIdFromPropertyInput = {
  source: AgencyFacade;
  property: "location_path_id";
};

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function normalizeAddressToken(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function zip5(value: string): string {
  return value.trim().slice(0, 5);
}

const POSTAL_AREA_PLACE_PATHS: readonly {
  state: string;
  zip5: string;
  places: readonly string[];
  paths: readonly string[];
}[] = [
  {
    state: "MN",
    zip5: "55111",
    places: ["st paul", "saint paul", "stpaul"],
    paths: ["/mn/ramsey-county/st-paul/", "/mn/ramsey-county/saint-paul/"],
  },
  {
    state: "MN",
    zip5: "55450",
    places: ["minneapolis"],
    paths: ["/mn/hennepin-county/minneapolis/"],
  },
  {
    state: "MN",
    zip5: "55804",
    places: ["duluth"],
    paths: ["/mn/st-louis-county/duluth/"],
  },
  {
    state: "MN",
    zip5: "56270",
    places: ["morton"],
    paths: ["/mn/renville-county/morton/"],
  },
  {
    state: "MN",
    zip5: "56241",
    places: ["granite falls"],
    paths: ["/mn/chippewa-county/granite-falls/"],
  },
];

function postalAreaPlacePaths(request: AddressResolutionRequest): string[] {
  const state = request.state.trim().toUpperCase();
  const normalizedPlace = normalizeAddressToken(request.place);
  const postalZip = zip5(request.zipCode);
  const rule = POSTAL_AREA_PLACE_PATHS.find(
    (candidate) =>
      candidate.state === state &&
      candidate.zip5 === postalZip &&
      candidate.places.includes(normalizedPlace),
  );

  return rule === undefined ? [] : [...rule.paths];
}

function isMissingContainingPlaceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("no place location_path_geometry boundary contains")
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function firstZodIssuePath(
  result: ReturnType<typeof LocationPathSpec.safeParse>,
): string {
  return result.success
    ? "record"
    : result.error.issues[0]?.path.join(".") || "record";
}

function malformedLocationPathMessage(locationPath: LocationPathRow): string {
  const result = LocationPathSpec.safeParse(locationPath);
  return result.success
    ? ""
    : `Cannot prepare public.location_path ${locationPath.location_path_id}; location path is malformed at ${firstZodIssuePath(result)}.`;
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function mostCommonColumns<TColumn extends string>(
  columnsByRecordName: Record<string, readonly TColumn[]>,
): TColumn[] | undefined {
  const counts = new Map<string, { columns: TColumn[]; count: number }>();

  for (const columns of Object.values(columnsByRecordName)) {
    const key = JSON.stringify(columns);
    const current = counts.get(key);
    if (current === undefined) {
      counts.set(key, { columns: [...columns], count: 1 });
    } else {
      current.count += 1;
    }
  }

  return [...counts.values()].sort((left, right) => right.count - left.count)[0]
    ?.columns;
}

function ownedColumnsMetadata(records: ImportRows): OwnedColumnsMetadata {
  return {
    agency: mostCommonColumns(records.ownedColumns.agencies),
    personnel: mostCommonColumns(records.ownedColumns.officers),
    agencyPersonnel: mostCommonColumns(records.ownedColumns.agencyOfficers),
  };
}

function recordOwnedColumns<T extends readonly string[]>(
  ownedColumns: T,
  defaultOwnedColumns: readonly string[] | undefined,
): T | undefined {
  return defaultOwnedColumns !== undefined &&
    arraysEqual(ownedColumns, defaultOwnedColumns)
    ? undefined
    : ownedColumns;
}

function mutationKind(
  operation: ImportOperation | undefined,
  recordKind: string,
): string {
  const resolvedOperation = operation ?? "create";
  return `${recordKind}${resolvedOperation[0]!.toUpperCase()}${resolvedOperation.slice(1)}`;
}

function databaseSpec(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const { sourceName, ...spec } = record;
  return spec;
}

function databaseMutationSpec(
  operation: ImportOperation | undefined,
  record: Record<string, unknown>,
): Record<string, unknown> {
  return operation === undefined || operation === "create"
    ? databaseSpec(record)
    : {};
}

function valueAsRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error("Artifacts agency record must be an object.");
}

function preparedAgencySpec(agency: AgencyRow): Record<string, unknown> {
  const { id: _id, sourceName: _sourceName, ...spec } = agency;
  return Object.fromEntries(
    Object.entries(spec).filter(([, value]) => value !== undefined),
  );
}

export class DataContext {
  readonly locations: LocationDataContext;
  readonly locationPaths: LocationPathDataContext;
  private readonly client?: DatabaseClient;
  readonly logger?: DataContextLogger;
  private readonly addressResolutionCache = new Map<
    string,
    LocationResolution
  >();
  private readonly databaseLocationPathsLoaded: boolean;
  private readonly databaseLocationPathById?: Map<string, LocationPathRow>;
  private readonly databaseLocationPathByPath?: Map<string, LocationPathRow>;
  private readonly databaseLocationPathIdByAliasPath?: Map<string, string>;
  private readonly entityResolvers?: DataContextOptions["entityResolvers"];
  private readonly importRows: ImportRows;
  private readonly operations: ImportOperations;
  private readonly loadLocationPathById?: DataContextOptions["loadLocationPathById"];
  private readonly loadLocationPathByPath?: DataContextOptions["loadLocationPathByPath"];
  private readonly resolveAddressFn?: DataContextOptions["resolveAddress"];
  private readonly resolveAdministrativeArea?: DataContextOptions["resolveAdministrativeArea"];
  private readonly agencyFieldResolutionOptions?: AgencyFieldResolutionOptions;
  private readonly resolvedProperties?: ResolvedProperties;
  private readonly commandName?: string;
  private readonly sourceNameToCanonicalIds?: SourceNameToCanonicalIds;
  private readonly databaseAgencyById: Map<string, Record<string, unknown>>;
  private readonly agencyFacades = new Map<string, FacadeEntry<AgencyFacade>>();
  private readonly personnelFacades = new Map<
    string,
    FacadeEntry<PersonnelFacade>
  >();
  private readonly agencyPersonnelFacades = new Map<
    string,
    FacadeEntry<AgencyPersonnelFacade>
  >();

  constructor(options: DataContextOptions) {
    this.client = options.client;
    this.importRows = options.rows;
    this.logger = options.logger;
    this.operations = options.operations ?? {
      locationPaths: {},
      locationPathGeometries: {},
      locationPathAliases: {},
      agencies: {},
      officers: {},
      agencyOfficers: {},
    };
    this.databaseLocationPathsLoaded =
      options.databaseLocationPaths !== undefined;
    this.databaseLocationPathById =
      options.databaseLocationPaths === undefined
        ? undefined
        : new Map(
            options.databaseLocationPaths.map((locationPath) => [
              locationPath.location_path_id,
              locationPath,
            ]),
          );
    this.databaseLocationPathByPath =
      options.databaseLocationPaths === undefined
        ? undefined
        : new Map(
            options.databaseLocationPaths.map((locationPath) => [
              locationPath.path,
              locationPath,
            ]),
          );
    this.databaseLocationPathIdByAliasPath =
      options.databaseLocationPathAliases === undefined
        ? undefined
        : new Map(
            options.databaseLocationPathAliases.map((locationPathAlias) => [
              locationPathAlias.alias_path,
              locationPathAlias.location_path_id,
            ]),
          );
    this.entityResolvers = options.entityResolvers;
    this.loadLocationPathById = options.loadLocationPathById;
    this.loadLocationPathByPath = options.loadLocationPathByPath;
    this.resolveAddressFn = options.resolveAddress;
    this.resolveAdministrativeArea = options.resolveAdministrativeArea;
    this.agencyFieldResolutionOptions = options.agencyFieldResolutionOptions;
    this.resolvedProperties = options.resolvedProperties;
    this.commandName = options.commandName;
    this.sourceNameToCanonicalIds = options.sourceNameToCanonicalIds;
    this.databaseAgencyById = new Map(
      (options.databaseAgencies ?? [])
        .map((agency) => [valueAsString(agency.id), agency] as const)
        .filter(
          (entry): entry is readonly [string, Record<string, unknown>] =>
            entry[0] !== undefined,
        ),
    );
    this.locations = new LocationDataContext(this);
    this.locationPaths = new LocationPathDataContext(this);
  }

  toImportRows(): ImportRows {
    return this.importRows;
  }

  validatePreparedRows(): string[] {
    return this.locationPaths.validatePreparedRows();
  }

  toImportOperations(): ImportOperations {
    return this.operations;
  }

  setOperation(
    entityType: ImportEntityType | "locationPath",
    rowId: string,
    operation: ImportOperation,
  ): void {
    if (entityType === "locationPath") {
      this.operations.locationPaths[rowId] = operation;
      return;
    }

    if (entityType === "agency") {
      this.operations.agencies[rowId] = operation;
      return;
    }

    if (entityType === "officer") {
      this.operations.officers[rowId] = operation;
      return;
    }

    this.operations.agencyOfficers[rowId] = operation;
  }

  async add<EntityType extends ImportEntityType>(
    entityType: EntityType,
    row: ImportEntityRow[EntityType],
  ): Promise<void> {
    if (entityType === "agency") {
      await this.addAgency(row as AgencyRow);
      return;
    }

    const resolver = this.entityResolvers?.[entityType] as
      | ImportEntityResolver<EntityType>
      | undefined;
    if (resolver === undefined) {
      throw new Error(`Unsupported import entity type ${entityType}.`);
    }

    await resolver(row, this);
  }

  private applyAgencyResolvedPropertyUpdates(
    updates: readonly AgencyResolvedPropertyUpdate[],
  ): void {
    if (this.resolvedProperties === undefined) {
      return;
    }

    for (const update of updates) {
      this.resolvedProperties.agencies[update.rowId] ??= {};
      Object.assign(
        this.resolvedProperties.agencies[update.rowId],
        update.mutation,
      );
    }
  }

  private async addAgency(agency: AgencyRow): Promise<void> {
    const existingAgency = this.databaseAgencyById.get(agency.id);
    if (existingAgency !== undefined) {
      return;
    }

    const adapters = {
      getLocationPathById: (locationPathId: string) =>
        this.locationPaths.getById(locationPathId),
      resolveAddress: (input: ResolveAddressInput) =>
        this.locations.resolveAddress(input),
    };

    try {
      const resolvedPropertyUpdates = await resolveCachedAgencyLocationPath(
        agency,
        adapters,
      );
      this.applyAgencyResolvedPropertyUpdates(resolvedPropertyUpdates);
    } catch (error) {
      agency.location_path_id = undefined;
      this.logger?.debug?.(
        {
          tableName: "public.agency",
          entityType: "agency",
          rowId: agency.id,
          locationPathId: agency.location_path_id,
          error: errorMessage(error),
        },
        "Cached import location path validation failed.",
      );
      throw error;
    }

    const missingColumns = missingResolvableAgencyFields(agency);
    if (missingColumns.length === 0) {
      return;
    }

    try {
      const resolution = await resolveAgencyMissingFields(
        agency,
        missingColumns,
        {
          adapters,
          agencyRows: this.toImportRows().agencies,
        },
        this.agencyFieldResolutionOptions ?? {},
      );
      this.applyAgencyResolvedPropertyUpdates(
        resolution.resolvedPropertyUpdates,
      );
      this.toImportRows().preparationMutations.push(
        ...resolution.preparationMutations,
      );
    } catch (error) {
      if (error instanceof AgencyFieldResolutionError) {
        this.applyAgencyResolvedPropertyUpdates(
          error.result.resolvedPropertyUpdates,
        );
        this.toImportRows().preparationMutations.push(
          ...error.result.preparationMutations,
        );
      }
      this.logger?.debug?.(
        {
          tableName: "public.agency",
          entityType: "agency",
          rowId: agency.id,
          missingFields: missingColumns,
          error: errorMessage(error),
        },
        "Agency field resolution failed.",
      );
      throw error;
    }
  }

  fromSource(input: SourceRecordContext): AgencyFacade {
    validateSourceRecordContext(input);
    const key = [input.apiVersion, input.namespace, "Agency", input.name].join(
      ":",
    );
    const existing = this.agencyFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) {
        existing.facade.merge(input.spec);
      }
      return existing.facade;
    }
    const canonicalId =
      input.canonicalId ??
      this.sourceNameToCanonicalIds?.agencies[input.name]?.canonicalId;
    const current =
      canonicalId === undefined
        ? input.current
        : (input.current ?? this.databaseAgencyById.get(canonicalId));
    const facade = new AgencyFacade(current);
    if (input.spec !== undefined) {
      facade.merge(input.spec);
    }
    this.agencyFacades.set(key, {
      facade,
      source: {
        namespace: input.namespace,
        name: input.name,
        canonicalId,
        commandName: input.commandName ?? this.commandName,
      },
    });
    return facade;
  }

  mergeAgencyArtifacts(artifacts: ArtifactsEnvelope): void {
    const preparedAgencyBySourceName = new Map(
      this.importRows.agencies.map((agency) => [
        agency.sourceName ?? agency.id,
        agency,
      ]),
    );

    for (const artifact of artifacts.spec.artifacts.filter(
      (item) => item.kind === "Agencies",
    )) {
      for (const [recordName, record] of Object.entries(
        artifact.spec.records,
      )) {
        const sourceName = sourceNameForImportRecord(recordName, record);
        const agency = preparedAgencyBySourceName.get(sourceName);
        if (agency === undefined) {
          throw new Error(
            `Prepared agency row is missing for source agency ${sourceName}.`,
          );
        }

        this.fromSource({
          apiVersion: INTAKE_API_VERSION,
          namespace: artifacts.metadata.namespace,
          name: sourceName,
          spec: valueAsRecord(record),
        }).merge(preparedAgencySpec(agency));
      }
    }
  }

  personnelFromSource(input: SourceRecordContext): PersonnelFacade {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "Personnel",
      input.name,
    ].join(":");
    const existing = this.personnelFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) {
        existing.facade.merge(input.spec);
      }
      return existing.facade;
    }
    const canonicalId =
      input.canonicalId ??
      this.sourceNameToCanonicalIds?.personnel[input.name]?.canonicalId;
    const facade = new PersonnelFacade(input.current);
    if (input.spec !== undefined) {
      facade.merge(input.spec);
    }
    this.personnelFacades.set(key, {
      facade,
      source: {
        namespace: input.namespace,
        name: input.name,
        canonicalId,
        commandName: input.commandName ?? this.commandName,
      },
    });
    return facade;
  }

  agencyPersonnelFromSource(input: SourceRecordContext): AgencyPersonnelFacade {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "AgencyPersonnel",
      input.name,
    ].join(":");
    const existing = this.agencyPersonnelFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) {
        existing.facade.merge(input.spec);
      }
      return existing.facade;
    }
    const canonicalId =
      input.canonicalId ??
      this.sourceNameToCanonicalIds?.agencyPersonnel[input.name]?.canonicalId;
    const facade = new AgencyPersonnelFacade(input.current);
    if (input.spec !== undefined) {
      facade.merge(input.spec);
    }
    this.agencyPersonnelFacades.set(key, {
      facade,
      source: {
        namespace: input.namespace,
        name: input.name,
        canonicalId,
        commandName: input.commandName ?? this.commandName,
      },
    });
    return facade;
  }

  toMutations(): (
    | AgencyCreateEnvelope
    | AgencyUpdateEnvelope
    | PersonnelCreateEnvelope
    | PersonnelUpdateEnvelope
    | AgencyPersonnelCreateEnvelope
    | AgencyPersonnelUpdateEnvelope
  )[] {
    return [
      ...[...this.agencyFacades.values()].map(({ facade, source }) =>
        facade.toMutation(source),
      ),
      ...[...this.personnelFacades.values()].map(({ facade, source }) =>
        facade.toMutation(source),
      ),
      ...[...this.agencyPersonnelFacades.values()].map(({ facade, source }) =>
        facade.toMutation(source),
      ),
    ];
  }

  toDatabaseMutationItems(): DatabaseMutationItem[] {
    const ownedColumns = ownedColumnsMetadata(this.importRows);
    const facadeMutations = this.toMutations().map((mutation) => ({
      kind: mutation.kind,
      name: mutation.metadata.name,
      spec: mutation.spec,
    }));
    const facadeAgencyIds = new Set(
      [...this.agencyFacades.values()]
        .map((entry) => valueAsString(entry.source.canonicalId))
        .filter((id): id is string => id !== undefined),
    );
    const facadePersonnelIds = new Set(
      [...this.personnelFacades.values()]
        .map((entry) => valueAsString(entry.source.canonicalId))
        .filter((id): id is string => id !== undefined),
    );
    const facadeAgencyPersonnelIds = new Set(
      [...this.agencyPersonnelFacades.values()]
        .map((entry) => valueAsString(entry.source.canonicalId))
        .filter((id): id is string => id !== undefined),
    );

    return [
      ...this.importRows.locationPaths.map((record) => ({
        kind: mutationKind(
          this.operations.locationPaths[record.location_path_id],
          "LocationPath",
        ),
        name: record.location_path_id,
        spec: databaseMutationSpec(
          this.operations.locationPaths[record.location_path_id],
          record,
        ),
      })),
      ...(this.importRows.locationPathGeometries ?? []).map((record) => ({
        kind: mutationKind(
          this.operations.locationPathGeometries[record.location_path_id],
          "LocationPathGeometry",
        ),
        name: record.location_path_id,
        spec: databaseMutationSpec(
          this.operations.locationPathGeometries[record.location_path_id],
          record,
        ),
      })),
      ...this.importRows.locationPathAliases.map((record) => ({
        kind: mutationKind(
          this.operations.locationPathAliases[record.alias_path],
          "LocationPathAlias",
        ),
        name: record.alias_path,
        spec: databaseMutationSpec(
          this.operations.locationPathAliases[record.alias_path],
          record,
        ),
      })),
      ...this.importRows.agencies
        .filter((record) => !facadeAgencyIds.has(record.id))
        .map((record) => {
          const recordOwnedColumnNames = recordOwnedColumns(
            this.importRows.ownedColumns.agencies[record.id] ?? [],
            ownedColumns.agency,
          );
          return {
            kind: mutationKind(this.operations.agencies[record.id], "Agency"),
            name: record.id,
            spec: databaseSpec(record),
            ...(recordOwnedColumnNames === undefined
              ? {}
              : { ownedColumns: recordOwnedColumnNames }),
          };
        }),
      ...facadeMutations,
      ...this.importRows.officers
        .filter((record) => !facadePersonnelIds.has(record.id))
        .map((record) => {
          const recordOwnedColumnNames = recordOwnedColumns(
            this.importRows.ownedColumns.officers[record.id] ?? [],
            ownedColumns.personnel,
          );
          return {
            kind: mutationKind(
              this.operations.officers[record.id],
              "Personnel",
            ),
            name: record.id,
            spec: databaseSpec(record),
            ...(recordOwnedColumnNames === undefined
              ? {}
              : { ownedColumns: recordOwnedColumnNames }),
          };
        }),
      ...this.importRows.agencyOfficers
        .filter((record) => !facadeAgencyPersonnelIds.has(record.id))
        .map((record) => {
          const recordOwnedColumnNames = recordOwnedColumns(
            this.importRows.ownedColumns.agencyOfficers[record.id] ?? [],
            ownedColumns.agencyPersonnel,
          );
          return {
            kind: mutationKind(
              this.operations.agencyOfficers[record.id],
              "AgencyPersonnel",
            ),
            name: record.id,
            spec: databaseSpec(record),
            ...(recordOwnedColumnNames === undefined
              ? {}
              : { ownedColumns: recordOwnedColumnNames }),
          };
        }),
    ];
  }

  toDatabaseMutations(
    metadata: DatabaseMutationsMetadataInput,
  ): DatabaseMutationsEnvelope {
    return DatabaseMutations.new({
      metadata,
      spec: {
        mutations: this.toDatabaseMutationItems(),
      },
    });
  }

  async canonicalIdFromProperty(
    input: CanonicalIdFromPropertyInput,
  ): Promise<string> {
    const source = [...this.agencyFacades.values()].find(
      (entry) => entry.facade === input.source,
    )?.source;
    if (source === undefined || input.property !== "location_path_id") {
      throw new Error(
        `Cannot resolve canonical ID for Agency.${input.property}.`,
      );
    }

    return (
      await this.locations.resolveAddress({
        entityType: "agency",
        entityId: source.name,
        state: input.source.string("state"),
        place: input.source.string("city"),
        zipCode: input.source.string("zip_code"),
        address: input.source.string("address"),
        administrativeAreaName: input.source.string(
          "location.administrativeAreaName",
        ),
        administrativeAreaSlug: input.source.string(
          "location.administrativeAreaSlug",
        ),
        latitude: input.source.number("latitude"),
        longitude: input.source.number("longitude"),
        name: input.source.string("name"),
        preferredLocationPathId: input.source.string("location_path_id"),
      })
    ).locationPathId;
  }

  async resolveLocationAdministrativeArea(
    input: LocationAdministrativeAreaRequest,
  ): Promise<LocationAdministrativeAreaResolution | undefined> {
    return this.resolveAdministrativeArea?.(input);
  }

  async resolveAddress(
    input: AddressResolutionRequest,
  ): Promise<AddressResolution | undefined> {
    return this.resolveAddressFn?.(input);
  }

  getCachedLocation(
    entityType: string,
    entityId: string,
  ): LocationResolution | undefined {
    return this.addressResolutionCache.get(`${entityType}:${entityId}`);
  }

  cacheLocation(
    entityType: string,
    entityId: string,
    resolution: LocationResolution,
  ): void {
    this.addressResolutionCache.set(`${entityType}:${entityId}`, resolution);
  }

  async loadLocationPathStateById(
    locationPathId: string,
  ): Promise<LocationPathRow | undefined> {
    return this.loadLocationPathById?.(locationPathId);
  }

  async loadLocationPathStateByPath(
    locationPathPath: string,
  ): Promise<LocationPathRow | undefined> {
    return this.loadLocationPathByPath?.(locationPathPath);
  }

  getDatabaseLocationPathById(
    locationPathId: string,
  ): LocationPathRow | undefined {
    return this.databaseLocationPathById?.get(locationPathId);
  }

  getDatabaseLocationPathByPath(path: string): LocationPathRow | undefined {
    return this.databaseLocationPathByPath?.get(path);
  }

  getDatabaseLocationPathIdByAliasPath(aliasPath: string): string | undefined {
    return this.databaseLocationPathIdByAliasPath?.get(aliasPath);
  }

  hasDatabaseLocationPathSnapshot(): boolean {
    return this.databaseLocationPathsLoaded;
  }

  databaseClient(): DatabaseClient {
    if (this.client === undefined) {
      throw new Error("Database client is required for database reads.");
    }
    return this.client;
  }
}

function addressResolutionRequest(
  input: ResolveAddressInput,
): AddressResolutionRequest {
  const missingFields = [
    valueAsString(input.entityType) === undefined ? "entityType" : undefined,
    valueAsString(input.entityId) === undefined ? "entityId" : undefined,
    valueAsString(input.state) === undefined ? "state" : undefined,
    valueAsString(input.place) === undefined ? "place" : undefined,
    valueAsString(input.zipCode) === undefined ? "zipCode" : undefined,
    valueAsString(input.address) === undefined ? "address" : undefined,
  ].filter((fieldName): fieldName is string => fieldName !== undefined);

  if (missingFields.length > 0) {
    throw new Error(
      `Cannot resolve address for ${String(input.entityType)} ${String(input.entityId)} without ${missingFields.join(", ")}.`,
    );
  }

  return {
    entityType: input.entityType,
    entityId: input.entityId,
    ...(valueAsString(input.sourceName) === undefined
      ? {}
      : { sourceName: valueAsString(input.sourceName)! }),
    ...(valueAsString(input.name) === undefined
      ? {}
      : { name: valueAsString(input.name)! }),
    address: input.address!,
    place: input.place!,
    state: input.state!,
    zipCode: input.zipCode!,
    ...(valueAsString(input.administrativeAreaName) === undefined
      ? {}
      : {
          administrativeAreaName: valueAsString(input.administrativeAreaName)!,
        }),
    ...(valueAsString(input.administrativeAreaSlug) === undefined
      ? {}
      : {
          administrativeAreaSlug: valueAsString(input.administrativeAreaSlug)!,
        }),
    ...(Number.isFinite(input.latitude) ? { latitude: input.latitude } : {}),
    ...(Number.isFinite(input.longitude) ? { longitude: input.longitude } : {}),
  };
}

class LocationDataContext {
  constructor(private readonly context: DataContext) {}

  private async postalAreaLocationPathId(
    request: AddressResolutionRequest,
  ): Promise<string | undefined> {
    for (const path of postalAreaPlacePaths(request)) {
      const locationPath = await this.context.locationPaths.getByPath(path);
      if (locationPath !== undefined) {
        return locationPath.location_path_id;
      }
    }

    return undefined;
  }

  async resolveAddress(
    input: ResolveAddressInput,
  ): Promise<LocationResolution> {
    const request = addressResolutionRequest(input);
    const cached = this.context.getCachedLocation(
      request.entityType,
      request.entityId,
    );
    if (cached !== undefined) {
      return cached;
    }

    const addressResolution = await this.context.resolveAddress(request);
    if (addressResolution === undefined) {
      throw new Error(
        `Cannot resolve address for ${request.entityType} ${request.entityId}.`,
      );
    }

    let locationPathId: string;
    try {
      locationPathId = await this.context.locationPaths.getPlaceContainingPoint(
        {
          latitude: addressResolution.latitude,
          longitude: addressResolution.longitude,
          rowId: request.entityId,
        },
      );
    } catch (error) {
      if (!isMissingContainingPlaceError(error)) {
        throw error;
      }
      const postalLocationPathId = await this.postalAreaLocationPathId(request);
      if (postalLocationPathId === undefined) {
        throw error;
      }
      locationPathId = postalLocationPathId;
    }
    const resolution = {
      locationPathId,
      addressLatitude: addressResolution.latitude,
      addressLongitude: addressResolution.longitude,
    };
    this.context.cacheLocation(
      request.entityType,
      request.entityId,
      resolution,
    );
    return resolution;
  }
}

class LocationPathDataContext {
  constructor(private readonly context: DataContext) {}

  private preparedByPath(path: string): LocationPathRow | undefined {
    return this.context
      .toImportRows()
      .locationPaths.find((locationPath) => locationPath.path === path);
  }

  private preparedById(locationPathId: string): LocationPathRow | undefined {
    return this.context
      .toImportRows()
      .locationPaths.find(
        (locationPath) => locationPath.location_path_id === locationPathId,
      );
  }

  private async databaseByPath(
    path: string,
  ): Promise<LocationPathRow | undefined> {
    const cached = this.context.getDatabaseLocationPathByPath(path);
    if (cached !== undefined) {
      return cached;
    }
    if (this.context.hasDatabaseLocationPathSnapshot()) {
      return undefined;
    }

    return readLocationPathByPath(this.context.databaseClient(), path);
  }

  private async databaseById(
    locationPathId: string,
  ): Promise<LocationPathRow | undefined> {
    const cached = this.context.getDatabaseLocationPathById(locationPathId);
    if (cached !== undefined) {
      return cached;
    }
    if (this.context.hasDatabaseLocationPathSnapshot()) {
      return undefined;
    }

    return readLocationPathById(this.context.databaseClient(), locationPathId);
  }

  async getById(locationPathId: string): Promise<LocationPathRow | undefined> {
    const prepared = this.preparedById(locationPathId);
    if (prepared !== undefined) {
      return prepared;
    }

    const canonical =
      await this.context.loadLocationPathStateById(locationPathId);
    if (canonical !== undefined) {
      return canonical;
    }

    return this.databaseById(locationPathId);
  }

  async getByPath(path: string): Promise<LocationPathRow | undefined> {
    const prepared = this.preparedByPath(path);
    if (prepared !== undefined) {
      return prepared;
    }

    const canonical = await this.context.loadLocationPathStateByPath(path);
    if (canonical !== undefined) {
      return canonical;
    }

    return this.databaseByPath(path);
  }

  async getByAliasPath(
    aliasPath: string,
  ): Promise<LocationPathRow | undefined> {
    const preparedAlias = this.context
      .toImportRows()
      .locationPathAliases.find((alias) => alias.alias_path === aliasPath);
    const locationPathId =
      preparedAlias?.location_path_id ??
      this.context.getDatabaseLocationPathIdByAliasPath(aliasPath);
    if (locationPathId !== undefined) {
      return this.getById(locationPathId);
    }

    if (this.context.hasDatabaseLocationPathSnapshot()) {
      return undefined;
    }

    const alias = await readLocationPathAliasByPath(
      this.context.databaseClient(),
      aliasPath,
    );
    const aliasLocationPathId = valueAsString(alias?.location_path_id);
    return aliasLocationPathId === undefined
      ? undefined
      : this.getById(aliasLocationPathId);
  }

  async getPlaceContainingPoint(input: {
    latitude: number;
    longitude: number;
    rowId?: unknown;
  }): Promise<string> {
    const matches = await readPlaceLocationPathsContainingPoint(
      this.context.databaseClient(),
      input,
    );
    if (matches.length === 0) {
      throw new Error(
        `Cannot resolve location_path_id for public.agency ${String(input.rowId)}; no place location_path_geometry boundary contains point ${input.latitude}, ${input.longitude}.`,
      );
    }
    const uniqueMatches = [
      ...new Map(
        matches.map((locationPath) => [
          locationPath.location_path_id,
          locationPath,
        ]),
      ).values(),
    ];
    if (uniqueMatches.length > 1) {
      throw new Error(
        `Cannot resolve location_path_id for public.agency ${String(input.rowId)}; multiple place location_path_geometry boundaries contain point ${input.latitude}, ${input.longitude}: ${uniqueMatches
          .map((locationPath) => locationPath.location_path_id)
          .sort()
          .join(", ")}.`,
      );
    }

    return uniqueMatches[0]!.location_path_id;
  }

  validatePreparedRows(): string[] {
    const errors: string[] = [];
    const locationPathIdByPath = new Map<string, string>();

    for (const locationPath of this.context.toImportRows().locationPaths) {
      const malformed = malformedLocationPathMessage(locationPath);
      if (malformed.length > 0) {
        errors.push(malformed);
        continue;
      }

      const existingId = locationPathIdByPath.get(locationPath.path);
      if (
        existingId !== undefined &&
        existingId !== locationPath.location_path_id
      ) {
        errors.push(
          `Cannot prepare public.location_path ${locationPath.location_path_id}; path ${locationPath.path} already belongs to prepared location path ${existingId}.`,
        );
        continue;
      }

      locationPathIdByPath.set(
        locationPath.path,
        locationPath.location_path_id,
      );
    }

    return errors;
  }
}
