import {
  facadeCanonicalIdResolver,
  type FacadeSource,
} from "../resolver-kit.js";
import {
  EntityFacade,
  type EntityFacadeBackend,
  type EntityResolvers,
} from "./entity-facade.js";
import {
  CoverageLinkCreate,
  type CoverageLinkCreateEnvelope,
} from "../io/generated-mutations/CoverageLinkCreate.js";
import {
  CoverageLinkUpdate,
  type CoverageLinkUpdateEnvelope,
} from "../io/generated-mutations/CoverageLinkUpdate.js";

/** An external document/citation (public.coverage_links). */
export type CoverageLinkRow = {
  id: string;
  url: string;
  normalized_url: string;
  title: string;
  source_name: string | null;
  published_at: string | null;
  notes: string | null;
};

export type CoverageLinkEnvelope =
  | CoverageLinkCreateEnvelope
  | CoverageLinkUpdateEnvelope;

const KIND = "CoverageLink";
const COLUMNS = [
  "url",
  "normalized_url",
  "title",
  "source_name",
  "published_at",
  "notes",
] as const;

/** A coverage link: canonical-id find-or-create + plain scalar columns. */
export function createCoverageLinkFacade(options: {
  current?: Record<string, unknown>;
  source: FacadeSource;
  backend: EntityFacadeBackend;
}): EntityFacade<CoverageLinkRow, CoverageLinkEnvelope> {
  const resolvers: EntityResolvers<CoverageLinkRow> = {
    id: facadeCanonicalIdResolver<CoverageLinkRow, EntityFacadeBackend>(KIND),
  };
  return new EntityFacade<CoverageLinkRow, CoverageLinkEnvelope>(
    KIND,
    COLUMNS,
    resolvers,
    { create: CoverageLinkCreate, update: CoverageLinkUpdate },
    options,
  );
}
