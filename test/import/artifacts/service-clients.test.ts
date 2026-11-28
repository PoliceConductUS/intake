import { expect, test } from "vitest";
import { DataContext } from "../../../src/cli/import/artifacts/data-context.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import type { ServiceClients } from "../../../src/shared/services/index.js";

type WithBackend = { backend: { serviceClients(): ServiceClients } };

function agencyBackend(context: DataContext) {
  const facade = context.facadeFromSource("Agency", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "com/example/source",
    name: "agency-1",
    spec: { name: "Example Police Department" },
  });
  return (facade as unknown as WithBackend).backend;
}

test("a resolver reaches the command's service clients through its backend", () => {
  const serviceClients = { skips: () => [] } as unknown as ServiceClients;
  expect(
    agencyBackend(new DataContext({ serviceClients })).serviceClients(),
  ).toBe(serviceClients);
});

test("a resolver that asks for clients the import was not given fails", () => {
  expect(() => agencyBackend(new DataContext({})).serviceClients()).toThrow(
    "This import was given no service clients",
  );
});
