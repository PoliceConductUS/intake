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
  AgencyPhoneNumberCreate,
  type AgencyPhoneNumberCreateEnvelope,
} from "../io/generated-mutations/AgencyPhoneNumberCreate.js";
import {
  AgencyPhoneNumberUpdate,
  type AgencyPhoneNumberUpdateEnvelope,
} from "../io/generated-mutations/AgencyPhoneNumberUpdate.js";

/** A phone/fax number attributed to an agency (public.agency_phone_numbers). */
export type AgencyPhoneNumberRow = {
  id: string;
  agency_id: string;
  phone_number: string;
  description: string | null;
};

export type AgencyPhoneNumberEnvelope =
  | AgencyPhoneNumberCreateEnvelope
  | AgencyPhoneNumberUpdateEnvelope;

const KIND = "AgencyPhoneNumber";
const COLUMNS = ["agency_id", "phone_number", "description"] as const;

/**
 * An agency phone number: canonical-id find-or-create, an Agency FK resolver,
 * and the plain phone_number/description columns passed through from the source.
 */
export function createAgencyPhoneNumberFacade(options: {
  current?: Record<string, unknown>;
  source: FacadeSource;
  backend: EntityFacadeBackend;
}): EntityFacade<AgencyPhoneNumberRow, AgencyPhoneNumberEnvelope> {
  const resolvers: EntityResolvers<AgencyPhoneNumberRow> = {
    id: facadeCanonicalIdResolver<AgencyPhoneNumberRow, EntityFacadeBackend>(
      KIND,
    ),
    agency_id: facadeForeignKeyResolver<AgencyPhoneNumberRow>(
      KIND,
      "agency_id",
      "Agency",
    ),
  };
  return new EntityFacade<AgencyPhoneNumberRow, AgencyPhoneNumberEnvelope>(
    KIND,
    COLUMNS,
    resolvers,
    { create: AgencyPhoneNumberCreate, update: AgencyPhoneNumberUpdate },
    options,
  );
}
