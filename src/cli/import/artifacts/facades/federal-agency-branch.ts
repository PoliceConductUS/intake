import {
  facadeCanonicalIdResolver,
  facadeForeignKeyResolver,
  type FacadeSource,
} from "../resolver-kit.js";
import {
  EntityFacade,
  type EntityFacadeBackend,
  type EntityResolvers,
} from "./entity-facade.js";
import {
  FederalAgencyBranchCreate,
  type FederalAgencyBranchCreateEnvelope,
} from "../io/generated-mutations/FederalAgencyBranchCreate.js";
import {
  FederalAgencyBranchUpdate,
  type FederalAgencyBranchUpdateEnvelope,
} from "../io/generated-mutations/FederalAgencyBranchUpdate.js";

/** Links a federal parent org to one of its agencies (public.federal_agency_branch). */
export type FederalAgencyBranchRow = {
  id: string;
  federal_agency_id: string;
  agency_id: string;
};

export type FederalAgencyBranchEnvelope =
  | FederalAgencyBranchCreateEnvelope
  | FederalAgencyBranchUpdateEnvelope;

const KIND = "FederalAgencyBranch";
const COLUMNS = ["federal_agency_id", "agency_id"] as const;

/** A federal parent → agency link; both fields are FK resolvers. */
export function createFederalAgencyBranchFacade(options: {
  current?: Record<string, unknown>;
  source: FacadeSource;
  backend: EntityFacadeBackend;
}): EntityFacade<FederalAgencyBranchRow, FederalAgencyBranchEnvelope> {
  const resolvers: EntityResolvers<FederalAgencyBranchRow> = {
    id: facadeCanonicalIdResolver<FederalAgencyBranchRow, EntityFacadeBackend>(
      KIND,
    ),
    federal_agency_id: facadeForeignKeyResolver<FederalAgencyBranchRow>(
      KIND,
      "federal_agency_id",
      "FederalAgency",
    ),
    agency_id: facadeForeignKeyResolver<FederalAgencyBranchRow>(
      KIND,
      "agency_id",
      "Agency",
    ),
  };
  return new EntityFacade<FederalAgencyBranchRow, FederalAgencyBranchEnvelope>(
    KIND,
    COLUMNS,
    resolvers,
    { create: FederalAgencyBranchCreate, update: FederalAgencyBranchUpdate },
    options,
  );
}
