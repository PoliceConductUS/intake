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
  DisciplineCreate,
  type DisciplineCreateEnvelope,
} from "../io/generated-mutations/DisciplineCreate.js";
import {
  DisciplineUpdate,
  type DisciplineUpdateEnvelope,
} from "../io/generated-mutations/DisciplineUpdate.js";

/** The database row shape a Discipline facade resolves toward (public.discipline). */
export type DisciplineRow = {
  id: string;
  action: string;
  effective_date: string | null;
  expiration_date: string | null;
  case_number: string | null;
};

export type DisciplineEnvelope =
  | DisciplineCreateEnvelope
  | DisciplineUpdateEnvelope;

const KIND = "Discipline";
const COLUMNS = [
  "action",
  "effective_date",
  "expiration_date",
  "case_number",
] as const;

/** A disciplinary event: canonical-id find-or-create + plain scalar columns. */
export function createDisciplineFacade(options: {
  current?: Record<string, unknown>;
  source: FacadeSource;
  backend: EntityFacadeBackend;
}): EntityFacade<DisciplineRow, DisciplineEnvelope> {
  const resolvers: EntityResolvers<DisciplineRow> = {
    id: facadeCanonicalIdResolver<DisciplineRow, EntityFacadeBackend>(KIND),
  };
  return new EntityFacade<DisciplineRow, DisciplineEnvelope>(
    KIND,
    COLUMNS,
    resolvers,
    { create: DisciplineCreate, update: DisciplineUpdate },
    options,
  );
}
