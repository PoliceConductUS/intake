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
  FederalAgencyCreate,
  type FederalAgencyCreateEnvelope,
} from "../io/generated-mutations/FederalAgencyCreate.js";
import {
  FederalAgencyUpdate,
  type FederalAgencyUpdateEnvelope,
} from "../io/generated-mutations/FederalAgencyUpdate.js";

export type FederalAgencyRow = {
  id: string;
  name: string;
  slug: string;
};

export type FederalAgencyEnvelope =
  | FederalAgencyCreateEnvelope
  | FederalAgencyUpdateEnvelope;

const KIND = "FederalAgency";
const COLUMNS = ["name", "slug"] as const;

export function createFederalAgencyFacade(options: {
  current?: Record<string, unknown>;
  source: FacadeSource;
  backend: EntityFacadeBackend;
}): EntityFacade<FederalAgencyRow, FederalAgencyEnvelope> {
  const resolvers: EntityResolvers<FederalAgencyRow> = {
    id: facadeCanonicalIdResolver<FederalAgencyRow, EntityFacadeBackend>(KIND),
  };
  return new EntityFacade<FederalAgencyRow, FederalAgencyEnvelope>(
    KIND,
    COLUMNS,
    resolvers,
    { create: FederalAgencyCreate, update: FederalAgencyUpdate },
    options,
  );
}
