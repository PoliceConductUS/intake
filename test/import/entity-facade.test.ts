import { describe, it, expect } from "vitest";
import { buildFacadeForKind } from "../../src/cli/import/artifacts/facades/resolver-registry.js";
import type { EntityFacadeBackend } from "../../src/cli/import/artifacts/facades/entity-facade.js";

// A backend whose canonical id is derived from the source id so assertions are
// deterministic, with an optional current-row map for the update path and a
// fixed FK-target resolver.
function backend(current?: Record<string, Record<string, unknown>>): {
  backend: EntityFacadeBackend;
} {
  return {
    backend: {
      findCanonicalId: async () => undefined,
      findOrCreateCanonicalId: async ({ sourceId }) => `canon:${sourceId}`,
      businessKeyId: (_key, resolve) => resolve(),
      findIdByBusinessKey: async () => undefined,
      mintId: () => "minted-id",
      existingRow: async (id) => current?.[id],
      findForeignKeyTarget: ({ kind, sourceId }) => ({
        value: async () => `fk:${kind}:${sourceId}`,
      }),
      getLocationPathByPath: async (path) => ({
        location_path_id: `lp:${path}`,
      }),
    },
  };
}

const source = { namespace: "mn-post", name: "0031|PB24-1-01" };

describe("EntityFacade via the discipline facades", () => {
  it("emits a create envelope with resolved id and passthrough columns", async () => {
    const facade = buildFacadeForKind("Discipline", { source, ...backend() });
    facade.merge({
      action: "SACO",
      effective_date: "2024-03-01",
      expiration_date: "2026-03-01",
      case_number: "PB24-1-01",
    });

    const mutation = (await facade.toMutation()) as {
      kind: string;
      spec: Record<string, unknown>;
    };
    expect(mutation.kind).toBe("DisciplineCreate");
    expect(mutation.spec).toMatchObject({
      id: "canon:0031|PB24-1-01",
      action: "SACO",
      effective_date: "2024-03-01",
      expiration_date: "2026-03-01",
      case_number: "PB24-1-01",
    });
  });

  it("emits an update with check/set operations against the current row", async () => {
    const facade = buildFacadeForKind("Discipline", {
      source: { ...source, commandName: "cmd-1" },
      ...backend({
        "canon:0031|PB24-1-01": {
          action: "SACO",
          effective_date: "2020-01-01",
          expiration_date: null,
          case_number: "PB24-1-01",
        },
      }),
    });
    facade.merge({
      action: "SACO",
      effective_date: "2024-03-01",
      expiration_date: "2026-03-01",
      case_number: "PB24-1-01",
    });

    const mutation = (await facade.toMutation()) as {
      kind: string;
      spec: Record<string, unknown>;
    };
    expect(mutation.kind).toBe("DisciplineUpdate");
    const ops = (
      mutation.spec as { operations: { action: string; path: string }[] }
    ).operations;
    const byPath = Object.fromEntries(ops.map((o) => [o.path, o.action]));
    // unchanged column → check; changed column → set.
    expect(byPath.action).toBe("check");
    expect(byPath.effective_date).toBe("set");
    expect(byPath.expiration_date).toBe("set");
  });

  it("omits a field the source did not provide, never overwriting it", async () => {
    const facade = buildFacadeForKind("Discipline", {
      source: { ...source, commandName: "cmd-1" },
      ...backend({
        "canon:0031|PB24-1-01": {
          action: "SACO",
          effective_date: "2024-03-01",
          expiration_date: "2026-03-01",
          case_number: "PB24-1-01",
        },
      }),
    });
    // expiration_date is absent — this source does not manage it, so it must not
    // appear in the update (the existing value is left untouched).
    facade.merge({
      action: "SACO",
      effective_date: "2024-03-01",
      case_number: "PB24-1-01",
    });

    const mutation = (await facade.toMutation()) as {
      spec: { operations: { path: string }[] };
    };
    const paths = mutation.spec.operations.map((op) => op.path);
    expect(paths).not.toContain("expiration_date");
  });

  it("writes an explicit null so a source can clear a field", async () => {
    const facade = buildFacadeForKind("Discipline", {
      source: { ...source, commandName: "cmd-1" },
      ...backend({
        "canon:0031|PB24-1-01": {
          action: "SACO",
          effective_date: "2024-03-01",
          expiration_date: "2026-03-01",
          case_number: "PB24-1-01",
        },
      }),
    });
    facade.merge({
      action: "SACO",
      effective_date: "2024-03-01",
      expiration_date: null,
      case_number: "PB24-1-01",
    });

    const mutation = (await facade.toMutation()) as {
      spec: { operations: { path: string; action: string; to?: unknown }[] };
    };
    const op = mutation.spec.operations.find(
      (candidate) => candidate.path === "expiration_date",
    );
    expect(op?.action).toBe("set");
    expect(op?.to).toBeNull();
  });

  it("resolves foreign keys through the backend target", async () => {
    const facade = buildFacadeForKind("DisciplineAgencyPersonnel", {
      source,
      ...backend(),
    });
    facade.merge({
      discipline_id: "0031|PB24-1-01",
      agency_personnel_id: "0031|a2jALPHA",
    });

    const mutation = (await facade.toMutation()) as {
      kind: string;
      spec: Record<string, unknown>;
    };
    expect(mutation.spec).toMatchObject({
      discipline_id: "fk:Discipline:0031|PB24-1-01",
      agency_personnel_id: "fk:AgencyPersonnel:0031|a2jALPHA",
    });
  });
});
