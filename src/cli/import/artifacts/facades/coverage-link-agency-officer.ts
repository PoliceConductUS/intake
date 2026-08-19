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
  CoverageLinkAgencyOfficerCreate,
  type CoverageLinkAgencyOfficerCreateEnvelope,
} from "../io/generated-mutations/CoverageLinkAgencyOfficerCreate.js";
import {
  CoverageLinkAgencyOfficerUpdate,
  type CoverageLinkAgencyOfficerUpdateEnvelope,
} from "../io/generated-mutations/CoverageLinkAgencyOfficerUpdate.js";

/** Links a coverage document to an assignment (public.coverage_link_agency_officers). */
export type CoverageLinkAgencyOfficerRow = {
  id: string;
  coverage_link_id: string;
  agency_officer_id: string;
  confidence: string;
  notes: string | null;
};

export type CoverageLinkAgencyOfficerEnvelope =
  | CoverageLinkAgencyOfficerCreateEnvelope
  | CoverageLinkAgencyOfficerUpdateEnvelope;

const KIND = "CoverageLinkAgencyOfficer";
const COLUMNS = [
  "coverage_link_id",
  "agency_officer_id",
  "confidence",
  "notes",
] as const;

/** Attributes a coverage document to an assignment; the two ids are FK resolvers. */
export function createCoverageLinkAgencyOfficerFacade(options: {
  current?: Record<string, unknown>;
  source: FacadeSource;
  backend: EntityFacadeBackend;
}): EntityFacade<
  CoverageLinkAgencyOfficerRow,
  CoverageLinkAgencyOfficerEnvelope
> {
  const resolvers: EntityResolvers<CoverageLinkAgencyOfficerRow> = {
    id: facadeCanonicalIdResolver<
      CoverageLinkAgencyOfficerRow,
      EntityFacadeBackend
    >(KIND),
    coverage_link_id: facadeForeignKeyResolver<CoverageLinkAgencyOfficerRow>(
      KIND,
      "coverage_link_id",
      "CoverageLink",
    ),
    agency_officer_id: facadeForeignKeyResolver<CoverageLinkAgencyOfficerRow>(
      KIND,
      "agency_officer_id",
      "AgencyPersonnel",
    ),
  };
  return new EntityFacade<
    CoverageLinkAgencyOfficerRow,
    CoverageLinkAgencyOfficerEnvelope
  >(
    KIND,
    COLUMNS,
    resolvers,
    {
      create: CoverageLinkAgencyOfficerCreate,
      update: CoverageLinkAgencyOfficerUpdate,
    },
    options,
  );
}
