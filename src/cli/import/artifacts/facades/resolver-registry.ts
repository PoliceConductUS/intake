import { z } from "zod";
import * as entitySpecs from "../../../../shared/io/generated/entity-specs.js";
import {
  FK_REFERENCES,
  RESOLVED_PROPERTIES,
} from "../../../../shared/io/generated/entity-specs.js";
import { importMutationEnvelopeTypes } from "../io/generated-mutations/index.js";
import {
  Resolver,
  facadeCanonicalIdResolver,
  facadeForeignKeyResolver,
  facadeNullableForeignKeyResolver,
  facadeLedgerForeignKeyResolver,
  facadeStateLocationPathResolver,
  titleCaseResolver,
  nameCaseResolver,
  nameCaseResolverNullable,
  lowerCaseEmailResolverNullable,
  type FacadeSource,
  type PropertyCache,
} from "../resolver-kit.js";
import {
  personnelSlugResolver,
  agencySlugResolver,
  agencyLocationPathResolver,
  agencyCoordinateResolver,
} from "./agency-personnel-resolvers.js";
import {
  EntityFacade,
  type EntityFacadeBackend,
  type EntityResolvers,
  type MutationConstructors,
} from "./entity-facade.js";

// The builder composes a heterogeneous map of resolvers keyed by column name; a
// facade's row is a plain string-keyed record at this layer, and the value/context
// generics are erased on purpose.
type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResolver = Resolver<any, any>;

/**
 * The per-kind resolution nuance that is NOT derivable from the schema. A kind
 * absent from this registry is fully generic: its identity is a minted canonical
 * `id`, its foreign keys are same-source finds, every other column passes
 * through, and it plans a create-or-update. Only the exceptions live here.
 */
type KindConfig = {
  /** Identity/primary-key column (default `id`). */
  identity?: string;
  /** Whether the identity is a minted canonical id (default) or a source natural key. */
  identityKind?: "canonical" | "natural";
  /** Existing row → a diffed update (default) or an idempotent read. */
  upsert?: "update" | "read";
  /** Columns dropped from the write when null (streamed/optional geometry). */
  omitWhenNull?: readonly string[];
  /**
   * Per-column resolvers that replace the derived default (a plain FK find, or
   * pass-through). Keyed by column: a location_path that resolves by state
   * rather than a same-run find, a cross-source ledger FK, a nullable FK.
   */
  overrides?: Record<string, AnyResolver>;
};

const REGISTRY: Record<string, KindConfig> = {
  Personnel: {
    overrides: {
      slug: personnelSlugResolver() as AnyResolver,
      first_name: nameCaseResolver<Row, EntityFacadeBackend>("first_name") as AnyResolver,
      last_name: nameCaseResolverNullable<Row, EntityFacadeBackend>("last_name") as AnyResolver,
      middle_name: nameCaseResolverNullable<Row, EntityFacadeBackend>("middle_name") as AnyResolver,
      prefix: nameCaseResolverNullable<Row, EntityFacadeBackend>("prefix") as AnyResolver,
      suffix: nameCaseResolverNullable<Row, EntityFacadeBackend>("suffix") as AnyResolver,
    },
  },
  Agency: {
    // slug/location_path_id/latitude/longitude are cache-backed
    // (RESOLVED_PROPERTIES.Agency); id is auto-canonical; state and zip_code are
    // plain codes and pass through uncased.
    overrides: {
      slug: agencySlugResolver() as AnyResolver,
      name: titleCaseResolver<Row, EntityFacadeBackend>("name") as AnyResolver,
      city: titleCaseResolver<Row, EntityFacadeBackend>("city") as AnyResolver,
      address: titleCaseResolver<Row, EntityFacadeBackend>("address") as AnyResolver,
      contact_name: nameCaseResolverNullable<Row, EntityFacadeBackend>("contact_name") as AnyResolver,
      contact_email: lowerCaseEmailResolverNullable<Row, EntityFacadeBackend>(
        "contact_email",
      ) as AnyResolver,
      location_path_id: agencyLocationPathResolver() as AnyResolver,
      latitude: agencyCoordinateResolver(
        "addressLatitude",
        "latitude",
      ) as AnyResolver,
      longitude: agencyCoordinateResolver(
        "addressLongitude",
        "longitude",
      ) as AnyResolver,
    },
  },
  LocationPath: {
    identity: "location_path_id",
    upsert: "read",
    omitWhenNull: ["centroid", "bbox"],
    overrides: {
      parent_location_path_id: facadeNullableForeignKeyResolver<Row>(
        "LocationPath",
        "parent_location_path_id",
        "LocationPath",
      ) as AnyResolver,
    },
  },
  LocationPathAlias: {
    identity: "alias_path",
    identityKind: "natural",
    upsert: "read",
  },
  LicensingAuthority: {
    overrides: {
      location_path_id: facadeStateLocationPathResolver<Row>(
        "LicensingAuthority",
      ) as AnyResolver,
    },
  },
  AgencyPersonnel: {
    // license_id is the one nullable FK: an officer may hold no license.
    overrides: {
      license_id: facadeNullableForeignKeyResolver<Row>(
        "AgencyPersonnel",
        "license_id",
        "License",
      ) as AnyResolver,
    },
  },
  CivilCase: {
    overrides: {
      location_path_id: facadeStateLocationPathResolver<Row>(
        "CivilCase",
      ) as AnyResolver,
    },
  },
  CivilCasePersonnel: {
    // The agency_personnel was created by a roster source, so it resolves through
    // the ledger, not a same-run facade (ADR 0023).
    overrides: {
      agency_personnel_id: facadeLedgerForeignKeyResolver<Row>(
        "CivilCasePersonnel",
        "agency_personnel_id",
        "AgencyPersonnel",
      ) as AnyResolver,
    },
  },
};

/** The identity/primary-key column a kind resolves and keys existing rows on. */
export function identityColumnForKind(kind: string): string {
  return REGISTRY[kind]?.identity ?? "id";
}

/** True when the generic builder can construct this kind. */
export function isRegistryKind(kind: string): boolean {
  return SUPPORTED_KINDS.has(kind);
}

// Every persisted entity kind the generic builder owns (LocationPathGeometry is
// streamed separately and is not a facade).
const SUPPORTED_KINDS = new Set<string>([
  "Agency",
  "Personnel",
  "LocationPath",
  "LocationPathAlias",
  "LicensingAuthority",
  "License",
  "LicenseAction",
  "AgencyPersonnel",
  "Discipline",
  "DisciplineAgencyPersonnel",
  "CoverageLink",
  "CoverageLinkAgencyPersonnel",
  "AgencyPhoneNumber",
  "FederalAgency",
  "FederalAgencyBranch",
  "CivilCase",
  "CivilCasePersonnel",
  "CivilCaseLink",
]);

function createSpecShapeKeys(kind: string): string[] {
  const spec = (entitySpecs as Record<string, unknown>)[`${kind}CreateSpec`];
  if (!(spec instanceof z.ZodObject)) {
    throw new Error(`No CreateSpec for kind ${kind}; cannot derive its columns.`);
  }
  return Object.keys(spec.shape);
}

function mutationsForKind(kind: string): MutationConstructors<unknown> {
  const all = importMutationEnvelopeTypes as Record<
    string,
    MutationConstructors<unknown>["create"]
  >;
  const create = all[`${kind}Create`];
  const update = all[`${kind}Update`];
  const read = all[`${kind}Read`];
  if (create === undefined) {
    throw new Error(`No Create mutation for kind ${kind}.`);
  }
  return { create, update, read } as MutationConstructors<unknown>;
}

/** The derived resolvers: identity (canonical mint) plus a find per foreign key. */
function derivedResolvers(
  kind: string,
  identity: string,
  identityKind: "canonical" | "natural",
): Record<string, AnyResolver> {
  const resolvers: Record<string, AnyResolver> = {};
  if (identityKind === "canonical") {
    resolvers[identity] = facadeCanonicalIdResolver<Row>(kind) as AnyResolver;
  }
  for (const fk of FK_REFERENCES[kind] ?? []) {
    resolvers[fk.field] = facadeForeignKeyResolver<Row>(
      kind,
      fk.field,
      fk.targetKind,
    ) as AnyResolver;
  }
  return resolvers;
}

/**
 * Build the facade for a registry-owned kind: derive its columns from the
 * generated CreateSpec, its create/update/read constructors by naming
 * convention, its id + FK resolvers from the schema, and layer the registry's
 * per-column overrides on top. Everything else passes through.
 */
export function buildFacadeForKind(
  kind: string,
  options: {
    current?: Record<string, unknown>;
    source: FacadeSource;
    backend: EntityFacadeBackend;
    cache?: PropertyCache;
  },
): EntityFacade<Row, unknown> {
  const config = REGISTRY[kind] ?? {};
  const identity = config.identity ?? "id";
  const identityKind = config.identityKind ?? "canonical";
  const columns = createSpecShapeKeys(kind).filter(
    (column) => column !== identity,
  );
  const resolvers = {
    ...derivedResolvers(kind, identity, identityKind),
    ...config.overrides,
  } as EntityResolvers<Row>;

  return new EntityFacade<Row, unknown>(
    kind,
    columns,
    resolvers,
    mutationsForKind(kind),
    {
      current: options.current,
      source: options.source,
      backend: options.backend,
      identity,
      upsert: config.upsert,
      omitWhenNull: config.omitWhenNull,
      cache: options.cache,
      cacheableProperties: RESOLVED_PROPERTIES[kind],
    },
  );
}
