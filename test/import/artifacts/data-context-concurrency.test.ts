import type { LedgerEntityKind } from "../../../src/cli/state/source-name-to-canonical-id/index.js";
import { fakeSourceNameLedger } from "../../cli/state/fake-source-name-ledger.js";
import { EmptyDatabaseClient } from "../../cli/database/empty-database-client.js";
import { setImmediate } from "node:timers/promises";
import { expect, test } from "vitest";
import { DataContext } from "../../../src/cli/import/artifacts/data-context.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";

for (const stage of ["graph", "identity", "mutation"] as const) {
  test(`${stage} bounds deferred resolutions and preserves registration order`, async () => {
    const ledger = fakeSourceNameLedger();
    for (let index = 0; index < 130; index++) {
      await ledger.findOrCreate(
        "test",
        "PersonnelEducation" as LedgerEntityKind,
        String(index),
        async () => `education-${index}`,
      );
    }
    const context = new DataContext({
      client: new EmptyDatabaseClient(),
      ledger,
    });
    context.facadeFromSource("Personnel", {
      apiVersion: INTAKE_API_VERSION,
      namespace: "test",
      name: "person",
      spec: {
        id: "person",
        first_name: "Test",
        last_name: "Person",
        slug: "person",
      },
    });
    const pending: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    let started = 0;
    const gate = async () => {
      started++;
      peak = Math.max(peak, ++active);
      await new Promise<void>((resolve) => pending.push(resolve));
      active--;
    };
    for (let index = 0; index < 130; index++) {
      const facade = context.facadeFromSource("PersonnelEducation", {
        apiVersion: INTAKE_API_VERSION,
        namespace: "test",
        name: String(index),
        spec: {
          id: `education-${index}`,
          personnel_id: "person",
          name: `Course ${index}`,
        },
      });
      if (stage === "mutation") {
        const original = facade.toMutation.bind(facade);
        facade.toMutation = async () => {
          await gate();
          return original();
        };
      } else {
        const original = facade.value.bind(facade);
        let gated = false;
        facade.value = async (property) => {
          if (property === "id" && !gated) {
            gated = true;
            await gate();
          }
          return original(property);
        };
      }
    }
    let ids: string[] = [];
    const operation =
      stage === "graph"
        ? context.selectAgencyGraph(async (incoming) => {
            ids = incoming
              .filter((record) => record.kind === "PersonnelEducation")
              .map((record) => record.id);
            return [];
          })
        : context.toMutations().then((mutations) => {
            ids = mutations
              .filter((mutation) =>
                mutation.kind.startsWith("PersonnelEducation"),
              )
              .map((mutation) => String(mutation.spec.id));
          });
    while (started === 0) await setImmediate();
    const initial = started;
    while (started < 130 || pending.length > 0) {
      for (const release of pending.splice(0).reverse()) release();
      await setImmediate();
    }
    await operation;
    expect(initial).toBe(64);
    expect(peak).toBe(64);
    expect(ids).toEqual(
      Array.from({ length: 130 }, (_, index) => `education-${index}`),
    );
  });
}

class EducationReadClient extends EmptyDatabaseClient {
  readonly batches: string[][] = [];
  override async query(text = "", values: readonly unknown[] = []) {
    if (text.includes("public.personnel_education") && text.includes("any(")) {
      this.batches.push(values[0] as string[]);
    }
    return { rows: [] };
  }
}

test("bounded mutation groups reuse CurrentRowReader same-tick coalescing", async () => {
  const client = new EducationReadClient();
  const ledger = fakeSourceNameLedger();
  const context = new DataContext({ client, ledger });
  context.facadeFromSource("Personnel", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "test",
    name: "person",
    spec: { first_name: "Test", last_name: "Person", slug: "person" },
  });
  for (let index = 0; index < 130; index++) {
    await ledger.findOrCreate(
      "test",
      "PersonnelEducation" as LedgerEntityKind,
      String(index),
      async () => `education-${index}`,
    );
    context.facadeFromSource("PersonnelEducation", {
      apiVersion: INTAKE_API_VERSION,
      namespace: "test",
      name: String(index),
      spec: { personnel_id: "person", name: `Course ${index}` },
    });
  }
  const mutations = await context.toMutations();
  expect(mutations).toHaveLength(131);
  expect(client.batches.map((batch) => batch.length)).toEqual([64, 64, 2]);
  expect(client.batches.flat()).toEqual(
    Array.from({ length: 130 }, (_, index) => `education-${index}`),
  );
});

for (const stage of ["graph", "identity", "mutation"] as const) {
  test(`${stage} propagates resolution failure without admitting another group`, async () => {
    const context = new DataContext({ client: new EmptyDatabaseClient() });
    const failure = new Error("resolution failed");
    let started = 0;
    for (let index = 0; index < 130; index++) {
      const facade = context.facadeFromSource("PersonnelEducation", {
        apiVersion: INTAKE_API_VERSION,
        namespace: "test",
        name: String(index),
      });
      const fail = async (): Promise<never> => {
        started++;
        throw failure;
      };
      if (stage === "mutation") {
        facade.value = async () => String(index);
        facade.toMutation = fail;
      } else {
        facade.value = fail;
      }
    }
    await expect(
      stage === "graph"
        ? context.selectAgencyGraph(async () => [])
        : context.toMutations(),
    ).rejects.toBe(failure);
    expect(started).toBe(64);
  });
}
