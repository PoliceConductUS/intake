import { describe, it, expect } from "vitest";
import {
  buildFacadeForKind,
  isRegistryKind,
  identityColumnForKind,
} from "../../src/cli/import/artifacts/facades/resolver-registry.js";
import { RECORD_KINDS_IN_DEPENDENCY_ORDER } from "../../src/shared/io/generated/entity-specs.js";
import type { EntityFacadeBackend } from "../../src/cli/import/artifacts/facades/entity-facade.js";

// A backend whose canonical id is derived from the source id so assertions are
// deterministic, with an optional current-row map for the update path and a
// fixed FK-target resolver.
function backend(
  current?: Record<string, Record<string, unknown>>,
  rowsByKind?: Record<string, Array<Record<string, unknown>>>,
): {
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
      findRowsByColumns: async (kind, constraints) =>
        (rowsByKind?.[kind] ?? []).filter((row) =>
          Object.entries(constraints).every(([column, constraint]) =>
            Array.isArray(constraint)
              ? constraint.includes(String(row[column]))
              : String(row[column]) === constraint,
          ),
        ),
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

describe("selector-resolved partial update (ADR 0034)", () => {
  it("resolves an officer by selector and sets only the provided field", async () => {
    const rowsByKind = {
      Agency: [{ id: "irving", name: "Irving Police Department" }],
      Personnel: [{ id: "p-markham", first_name: "James", last_name: "Markham" }],
      AgencyPersonnel: [
        { id: "ap-markham", agency_id: "irving", personnel_id: "p-markham" },
      ],
    };
    const current = {
      "ap-markham": { id: "ap-markham", badge_number: null },
    };
    const facade = buildFacadeForKind("AgencyPersonnel", {
      source: {
        namespace: "org.policeconduct.manual",
        name: "markham-badge",
        commandName: "manual-badge-backfill",
        action: "PATCH",
        selector: {
          agency: { name: "Irving Police Department" },
          personnel: { first_name: "James", last_name: "Markham" },
        },
      },
      ...backend(current, rowsByKind),
    });
    facade.merge({ badge_number: "1379" });

    const mutation = (await facade.toMutation()) as {
      kind: string;
      metadata: { name: string };
      spec: { operations: Array<{ action: string; path: string; to?: unknown }> };
    };

    // The selector materialized to the officer's real id (the mutation's target).
    expect(mutation.kind).toBe("AgencyPersonnelUpdate");
    expect(mutation.metadata.name).toBe("ap-markham");
    // Only badge_number is written — the untouched foreign keys are never resolved.
    const sets = mutation.spec.operations.filter((op) => op.action === "set");
    expect(sets).toEqual([
      expect.objectContaining({ path: "badge_number", to: "1379" }),
    ]);
  });
});

describe("registry coverage and identity", () => {
  // The generic builder must own every entity kind except the stream-only ones,
  // so a kind a source emits is never silently dropped for want of a hand-list
  // entry (the CoverageLinkCivilCase / AgencyLink drift this consolidation fixed).
  const STREAM_ONLY = new Set(["LocationPathGeometry"]);

  for (const kind of RECORD_KINDS_IN_DEPENDENCY_ORDER) {
    it(`${kind} is ${STREAM_ONLY.has(kind) ? "stream-only (no facade)" : "buildable by the registry"}`, () => {
      expect(isRegistryKind(kind)).toBe(!STREAM_ONLY.has(kind));
    });
  }

  it("keys self-natural-key tables on their primary-key column", () => {
    // Independent oracle: these tables' primary keys are natural, not a cuid id.
    expect(identityColumnForKind("LocationPath")).toBe("location_path_id");
    expect(identityColumnForKind("LocationPathAlias")).toBe("alias_path");
    // A cuid-keyed table falls through to the id column.
    expect(identityColumnForKind("Agency")).toBe("id");
  });
});
