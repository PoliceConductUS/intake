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
  CivilCaseLinkCreate,
  type CivilCaseLinkCreateEnvelope,
} from "../io/generated-mutations/CivilCaseLinkCreate.js";
import {
  CivilCaseLinkUpdate,
  type CivilCaseLinkUpdateEnvelope,
} from "../io/generated-mutations/CivilCaseLinkUpdate.js";

export type CivilCaseLinkRow = {
  id: string;
  civil_case_id: string;
  url: string;
  title: string;
};

export type CivilCaseLinkEnvelope =
  | CivilCaseLinkCreateEnvelope
  | CivilCaseLinkUpdateEnvelope;

const KIND = "CivilCaseLink";
const COLUMNS = ["civil_case_id", "url", "title"] as const;

export function createCivilCaseLinkFacade(options: {
  current?: Record<string, unknown>;
  source: FacadeSource;
  backend: EntityFacadeBackend;
}): EntityFacade<CivilCaseLinkRow, CivilCaseLinkEnvelope> {
  const resolvers: EntityResolvers<CivilCaseLinkRow> = {
    id: facadeCanonicalIdResolver<CivilCaseLinkRow, EntityFacadeBackend>(KIND),
    civil_case_id: facadeForeignKeyResolver<CivilCaseLinkRow>(
      KIND,
      "civil_case_id",
      "CivilCase",
    ),
  };
  return new EntityFacade<CivilCaseLinkRow, CivilCaseLinkEnvelope>(
    KIND,
    COLUMNS,
    resolvers,
    { create: CivilCaseLinkCreate, update: CivilCaseLinkUpdate },
    options,
  );
}
