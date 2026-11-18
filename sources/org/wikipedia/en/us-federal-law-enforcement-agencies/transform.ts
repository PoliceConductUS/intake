import type { InputAccounting } from "../../../../../src/cli/transform/accounting.js";
import type {
  EmittedRecords,
  TransformDeps,
  SourceTransform,
} from "../../../../../src/cli/transform/source-transform.js";
import {
  OFFICES_FILE,
  OfficesFileSchema,
  ORGS_FILE,
  OrgsFileSchema,
  SOURCE_ID,
  readCuratedFile,
} from "./model.js";

export const transform: SourceTransform = async ({
  state,
  logger,
}: TransformDeps) => {
  const log = logger ?? { info() {} };
  const orgs =
    (await readCuratedFile(state, ORGS_FILE, OrgsFileSchema))?.agencies ?? [];
  const offices =
    (await readCuratedFile(state, OFFICES_FILE, OfficesFileSchema))?.offices ??
    [];

  const orgAccounting: InputAccounting = {
    input: ORGS_FILE,
    read: 0,
    emitted: 0,
    reported: 0,
    notSelected: {},
  };
  const federalAgencies: EmittedRecords = {};
  for (const org of orgs) {
    orgAccounting.read += 1;
    if (federalAgencies[org.slug])
      throw new Error(`${SOURCE_ID}: ${ORGS_FILE} repeats slug ${org.slug}`);
    federalAgencies[org.slug] = { spec: { name: org.name, slug: org.slug } };
    orgAccounting.emitted += 1;
  }

  const officeAccounting: InputAccounting = {
    input: OFFICES_FILE,
    read: 0,
    emitted: 0,
    reported: 0,
    notSelected: {},
  };
  const agencies: EmittedRecords = {};
  for (const office of offices) {
    officeAccounting.read += 1;
    if (!federalAgencies[office.federal_agency])
      throw new Error(
        `${SOURCE_ID}: ${OFFICES_FILE} office ${office.slug} names federal agency ${office.federal_agency}, which is not in ${ORGS_FILE}`,
      );
    if (agencies[office.slug])
      throw new Error(
        `${SOURCE_ID}: ${OFFICES_FILE} repeats slug ${office.slug}`,
      );
    agencies[office.slug] = {
      spec: {
        parent_federal_agency_id: office.federal_agency,
        name: office.name,
        state: office.state,
        city: office.city,
        address: office.address,
        zip_code: office.zip_code,
      },
    };
    officeAccounting.emitted += 1;
  }

  log.info(
    `federal-le: ${Object.keys(federalAgencies).length} agencies, ` +
      `${Object.keys(agencies).length} offices`,
  );

  return {
    artifacts: [
      { kind: "FederalAgencies", records: federalAgencies },
      { kind: "Agencies", records: agencies },
    ],
    accounting: [orgAccounting, officeAccounting],
  };
};
