import { expect, test } from "vitest";
import { DataContext } from "../../../src/cli/import/artifacts/data-context.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import { fakeSourceNameLedger } from "../../cli/state/fake-source-name-ledger.js";
import { EmptyDatabaseClient } from "../../cli/database/empty-database-client.js";

function context() {
  return new DataContext({
    client: new EmptyDatabaseClient(),
    ledger: fakeSourceNameLedger(),
  });
}
function add(
  data: DataContext,
  kind: string,
  name: string,
  spec: Record<string, unknown>,
) {
  return data.facadeFromSource(kind, {
    apiVersion: INTAKE_API_VERSION,
    namespace: "test.graph",
    name,
    spec,
  });
}

test("shared selection excludes an unqualified agency before requiring its address", async () => {
  const data = context();
  add(data, "Agency", "closed", { name: "Closed PD", state: "TX" });
  const omitted = await data.selectAgencyGraph(async () => []);
  expect(omitted).toEqual({ Agency: 1 });
  expect(await data.toMutations()).toEqual([]);
});

test("selection retains a later personnel candidate attached to a stored qualifying assignment", async () => {
  const data = context();
  const person = add(data, "Personnel", "person", { first_name: "Updated" });
  const id = String(await person.value("id"));
  const omitted = await data.selectAgencyGraph(async () => [
    { kind: "Agency", id: "existing-agency", values: {} },
    {
      kind: "AgencyPersonnel",
      id: "existing-job",
      values: {
        agency_id: "existing-agency",
        personnel_id: id,
        end_date: null,
      },
    },
  ]);
  expect(omitted).toEqual({});
  const mutations = await data.toMutations();
  expect(mutations.map((m) => m.kind)).toEqual(["PersonnelCreate"]);
  expect(mutations[0]!.spec).toMatchObject({ first_name: "Updated" });
});

test("no source end date is not converted to a null qualification during graph preparation", async () => {
  const data = context();
  add(data, "Agency", "agency", { name: "Unknown Status", state: "TX" });
  add(data, "Personnel", "person", { first_name: "Someone" });
  add(data, "AgencyPersonnel", "job", {
    agency_id: "agency",
    personnel_id: "person",
    start_date: "2020-01-01",
    title: "Officer",
  });
  const omitted = await data.selectAgencyGraph(async () => []);
  expect(omitted).toEqual({ Agency: 1, Personnel: 1, AgencyPersonnel: 1 });
  expect(await data.toMutations()).toEqual([]);
});
