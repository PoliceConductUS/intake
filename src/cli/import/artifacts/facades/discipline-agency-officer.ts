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
  DisciplineAgencyOfficerCreate,
  type DisciplineAgencyOfficerCreateEnvelope,
} from "../io/generated-mutations/DisciplineAgencyOfficerCreate.js";
import {
  DisciplineAgencyOfficerUpdate,
  type DisciplineAgencyOfficerUpdateEnvelope,
} from "../io/generated-mutations/DisciplineAgencyOfficerUpdate.js";

/** Attribution of a discipline event to an assignment (public.discipline_agency_officers). */
export type DisciplineAgencyOfficerRow = {
  id: string;
  discipline_id: string;
  agency_officer_id: string;
};

export type DisciplineAgencyOfficerEnvelope =
  | DisciplineAgencyOfficerCreateEnvelope
  | DisciplineAgencyOfficerUpdateEnvelope;

const KIND = "DisciplineAgencyOfficer";
const COLUMNS = ["discipline_id", "agency_officer_id"] as const;

/** Links a discipline event to an assignment; both fields are FK resolvers. */
export function createDisciplineAgencyOfficerFacade(options: {
  current?: Record<string, unknown>;
  source: FacadeSource;
  backend: EntityFacadeBackend;
}): EntityFacade<DisciplineAgencyOfficerRow, DisciplineAgencyOfficerEnvelope> {
  const resolvers: EntityResolvers<DisciplineAgencyOfficerRow> = {
    id: facadeCanonicalIdResolver<
      DisciplineAgencyOfficerRow,
      EntityFacadeBackend
    >(KIND),
    discipline_id: facadeForeignKeyResolver<DisciplineAgencyOfficerRow>(
      KIND,
      "discipline_id",
      "Discipline",
    ),
    agency_officer_id: facadeForeignKeyResolver<DisciplineAgencyOfficerRow>(
      KIND,
      "agency_officer_id",
      "AgencyPersonnel",
    ),
  };
  return new EntityFacade<
    DisciplineAgencyOfficerRow,
    DisciplineAgencyOfficerEnvelope
  >(
    KIND,
    COLUMNS,
    resolvers,
    {
      create: DisciplineAgencyOfficerCreate,
      update: DisciplineAgencyOfficerUpdate,
    },
    options,
  );
}
