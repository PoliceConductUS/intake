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
  CivilCaseOfficerCreate,
  type CivilCaseOfficerCreateEnvelope,
} from "../io/generated-mutations/CivilCaseOfficerCreate.js";
import {
  CivilCaseOfficerUpdate,
  type CivilCaseOfficerUpdateEnvelope,
} from "../io/generated-mutations/CivilCaseOfficerUpdate.js";

export type CivilCaseOfficerRow = {
  id: string;
  civil_case_id: string;
  agency_officer_id: string;
};

export type CivilCaseOfficerEnvelope =
  | CivilCaseOfficerCreateEnvelope
  | CivilCaseOfficerUpdateEnvelope;

const KIND = "CivilCaseOfficer";
const COLUMNS = ["civil_case_id", "agency_officer_id"] as const;

export function createCivilCaseOfficerFacade(options: {
  current?: Record<string, unknown>;
  source: FacadeSource;
  backend: EntityFacadeBackend;
}): EntityFacade<CivilCaseOfficerRow, CivilCaseOfficerEnvelope> {
  const resolvers: EntityResolvers<CivilCaseOfficerRow> = {
    id: facadeCanonicalIdResolver<CivilCaseOfficerRow, EntityFacadeBackend>(
      KIND,
    ),
    civil_case_id: facadeForeignKeyResolver<CivilCaseOfficerRow>(
      KIND,
      "civil_case_id",
      "CivilCase",
    ),
  };
  return new EntityFacade<CivilCaseOfficerRow, CivilCaseOfficerEnvelope>(
    KIND,
    COLUMNS,
    resolvers,
    { create: CivilCaseOfficerCreate, update: CivilCaseOfficerUpdate },
    options,
  );
}
