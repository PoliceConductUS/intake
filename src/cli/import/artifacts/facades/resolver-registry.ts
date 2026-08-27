import { z } from "zod";
import * as entitySpecs from "../../../../shared/io/generated/entity-specs.js";
import {
  FK_REFERENCES,
  RESOLVED_PROPERTIES,
  BUSINESS_KEYS,
} from "../../../../shared/io/generated/entity-specs.js";
import { importMutationEnvelopeTypes } from "../io/generated-mutations/index.js";
import {
  Resolver,
  facadeCanonicalIdResolver,
  facadeComposedIdResolver,
  facadeBusinessKeyIdResolver,
  facadeForeignKeyResolver,
  facadeNullableForeignKeyResolver,
  facadeLedgerForeignKeyResolver,
  facadeStateLocationPathResolver,
  titleCaseResolver,
  titleCaseResolverNullable,
  nameCaseResolver,
  nameCaseResolverNullable,
  lowerCaseEmailResolverNullable,
  type FacadeSource,
  type PropertyCache,
} from "../resolver-kit.js";
import {
  personnelSlugResolver,
  agencySlugResolver,
} from "./agency-personnel-resolvers.js";
import { latLngFromAddress } from "./geocode-resolvers.js";
import {
  coverageLinkIdResolver,
  civilCaseReferenceResolver,
} from "./coverage-resolvers.js";
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
      first_name: nameCaseResolver<Row, EntityFacadeBackend>(
        "first_name",
      ) as AnyResolver,
      last_name: nameCaseResolverNullable<Row, EntityFacadeBackend>(
        "last_name",
      ) as AnyResolver,
      middle_name: nameCaseResolverNullable<Row, EntityFacadeBackend>(
        "middle_name",
      ) as AnyResolver,
      prefix: nameCaseResolverNullable<Row, EntityFacadeBackend>(
        "prefix",
      ) as AnyResolver,
      suffix: nameCaseResolverNullable<Row, EntityFacadeBackend>(
        "suffix",
      ) as AnyResolver,
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
      address: titleCaseResolver<Row, EntityFacadeBackend>(
        "address",
      ) as AnyResolver,
      contact_name: nameCaseResolverNullable<Row, EntityFacadeBackend>(
        "contact_name",
      ) as AnyResolver,
      contact_email: lowerCaseEmailResolverNullable<Row, EntityFacadeBackend>(
        "contact_email",
      ) as AnyResolver,
      // One geocode sets location_path_id + latitude + longitude (ADR 0019).
      ...(latLngFromAddress({
        entityType: "agency",
        from: {
          state: "state",
          place: "city",
          zipCode: "zip_code",
          address: "address",
          name: "name",
          location: "location",
        },
        set: {
          latitude: "latitude",
          longitude: "longitude",
          locationPathId: "location_path_id",
        },
      }) as Record<string, AnyResolver>),
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
    // location_path_id needs no override: the derived FK chain resolves a
    // LocationPath reference same-run (census emits the path + alias together) or,
    // when only the alias is emitted (a curated manual alias), by the target's path
    // against the DB (ADR 0031/0023). Resolve-or-fail; never mints.
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
  AuthorityLicense: {
    // A license type scoped by its authority. Identity is find-or-mint by the
    // (licensing_authority_id, name) business key; the source emits the name already
    // canonicalized (ADR 0031).
    identityKind: "natural",
    overrides: {
      id: facadeBusinessKeyIdResolver<Row>(
        "AuthorityLicense",
        BUSINESS_KEYS.AuthorityLicense,
      ) as AnyResolver,
    },
  },
  License: {
    // The officer's holding of an authority_license. Identity is find-or-mint by the
    // (personnel_id, authority_license_id) business key, so re-imports and same-type
    // variants converge on one row.
    identityKind: "natural",
    overrides: {
      id: facadeBusinessKeyIdResolver<Row>(
        "License",
        BUSINESS_KEYS.License,
      ) as AnyResolver,
      status: titleCaseResolverNullable<Row, EntityFacadeBackend>(
        "status",
      ) as AnyResolver,
    },
  },
  CivilCase: {
    // Identity is the source-provided natural key `court:docket` (ADR 0028), not a
    // minted canonical, so the Clearinghouse and CourtListener converge on one row
    // for the same docket. The source sets `spec.id`; there is no ledger mint.
    identityKind: "natural",
    overrides: {
      location_path_id: facadeStateLocationPathResolver<Row>(
        "CivilCase",
      ) as AnyResolver,
    },
  },
  CivilCasePersonnel: {
    // Identity is composed from the two resolved FKs (ADR 0028), so the same
    // officer named in the same case by two sources converges on one row. Both
    // halves are canonical: civil_case_id resolves to the case's natural key,
    // agency_personnel_id through the ledger to the roster's canonical id.
    identityKind: "natural",
    overrides: {
      id: facadeComposedIdResolver<Row>([
        "civil_case_id",
        "agency_personnel_id",
      ]) as AnyResolver,
      // The agency_personnel was created by a roster source, so it resolves through
      // the ledger, not a same-run facade (ADR 0023).
      agency_personnel_id: facadeLedgerForeignKeyResolver<Row>(
        "CivilCasePersonnel",
        "agency_personnel_id",
        "AgencyPersonnel",
      ) as AnyResolver,
    },
  },
  CoverageLink: {
    // Identity is the normalized URL (ADR 0028): a URL is unique in coverage_links.
    identityKind: "natural",
    overrides: {
      id: coverageLinkIdResolver() as AnyResolver,
    },
  },
  CoverageLinkCivilCase: {
    // civil_case_id references an existing case (another source) by its natural
    // key, so it passes through as the canonical id (ADR 0023/0028).
    overrides: {
      civil_case_id: civilCaseReferenceResolver() as AnyResolver,
    },
  },
  CoverageLinkAgencyPersonnel: {
    // The officer belongs to a roster source, so agency_personnel_id resolves
    // through the ledger, not a same-run facade (ADR 0023) — this holds whether
    // the coverage source produced the roster (mn-post) or only references it
    // via resolvePersonnel (youtube.policeactivity).
    overrides: {
      agency_personnel_id: facadeLedgerForeignKeyResolver<Row>(
        "CoverageLinkAgencyPersonnel",
        "agency_personnel_id",
        "AgencyPersonnel",
      ) as AnyResolver,
    },
  },
  Review: {
    // A published report (ADR 0030). id is the submission's natural id; a verified
    // submission is immutable, so an existing report is a no-op read on re-import
    // (never re-diffed or rewritten). One geocode from the report's address sets
    // location + coordinates on first create.
    identityKind: "natural",
    upsert: "read",
    overrides: {
      ...(latLngFromAddress({
        entityType: "review",
        from: {
          state: "state",
          place: "city",
          zipCode: "zip_code",
          address: "address",
          name: "title",
        },
        set: {
          latitude: "latitude",
          longitude: "longitude",
          locationPathId: "location_path_id",
        },
      }) as Record<string, AnyResolver>),
    },
  },
  ReviewPersonnel: {
    // The report's link to one resolved officer@agency (ADR 0030). Composed natural
    // id from (review_id, agency_personnel_id); the officer resolves through the
    // ledger (run matched it against a roster). review_id resolves same-run. Like
    // the report, an existing link is a no-op read on re-import.
    identityKind: "natural",
    upsert: "read",
    overrides: {
      id: facadeComposedIdResolver<Row>([
        "review_id",
        "agency_personnel_id",
      ]) as AnyResolver,
      agency_personnel_id: facadeLedgerForeignKeyResolver<Row>(
        "ReviewPersonnel",
        "agency_personnel_id",
        "AgencyPersonnel",
      ) as AnyResolver,
    },
  },
  ArrestProfile: {
    // A per-officer arrest profile (ADR 0032). Identity is find-or-mint by the
    // unique agency_personnel_id business key, so a re-run updates the one row in
    // place (default "update" upsert — the summary is recomputed each run). The
    // officer resolves cross-source through the ledger; coverage/breakdowns jsonb
    // pass through unresolved.
    identityKind: "natural",
    overrides: {
      id: facadeBusinessKeyIdResolver<Row>(
        "ArrestProfile",
        BUSINESS_KEYS.ArrestProfile,
      ) as AnyResolver,
      agency_personnel_id: facadeLedgerForeignKeyResolver<Row>(
        "ArrestProfile",
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
  "AuthorityLicense",
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
  "Review",
  "ReviewPersonnel",
  "ArrestProfile",
]);

function createSpecShapeKeys(kind: string): string[] {
  const spec = (entitySpecs as Record<string, unknown>)[`${kind}CreateSpec`];
  if (!(spec instanceof z.ZodObject)) {
    throw new Error(
      `No CreateSpec for kind ${kind}; cannot derive its columns.`,
    );
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
