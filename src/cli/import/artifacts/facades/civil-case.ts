import {
  facadeCanonicalIdResolver,
  facadeStateLocationPathResolver,
  type FacadeSource,
} from "../resolver-kit.js";
import {
  EntityFacade,
  type EntityFacadeBackend,
  type EntityResolvers,
} from "./entity-facade.js";
import {
  CivilCaseCreate,
  type CivilCaseCreateEnvelope,
} from "../io/generated-mutations/CivilCaseCreate.js";
import {
  CivilCaseUpdate,
  type CivilCaseUpdateEnvelope,
} from "../io/generated-mutations/CivilCaseUpdate.js";

export type CivilCaseRow = {
  id: string;
  title: string;
  cause_number: string;
  court: string | null;
  filed_date: string;
  claims_summary: string;
  slug: string;
  outcome: string | null;
  primary_source_url: string | null;
  date_terminated: string | null;
  location_path_id: string;
};

export type CivilCaseEnvelope =
  | CivilCaseCreateEnvelope
  | CivilCaseUpdateEnvelope;

const KIND = "CivilCase";
const COLUMNS = [
  "title",
  "cause_number",
  "court",
  "filed_date",
  "claims_summary",
  "slug",
  "outcome",
  "primary_source_url",
  "date_terminated",
  "location_path_id",
] as const;

export function createCivilCaseFacade(options: {
  current?: Record<string, unknown>;
  source: FacadeSource;
  backend: EntityFacadeBackend;
}): EntityFacade<CivilCaseRow, CivilCaseEnvelope> {
  const resolvers: EntityResolvers<CivilCaseRow> = {
    id: facadeCanonicalIdResolver<CivilCaseRow, EntityFacadeBackend>(KIND),
    location_path_id: facadeStateLocationPathResolver<
      CivilCaseRow,
      EntityFacadeBackend
    >(KIND),
  };
  return new EntityFacade<CivilCaseRow, CivilCaseEnvelope>(
    KIND,
    COLUMNS,
    resolvers,
    { create: CivilCaseCreate, update: CivilCaseUpdate },
    options,
  );
}
