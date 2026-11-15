import { expect, test } from "vitest";
import { z } from "zod";
import { referenceResolver } from "../../src/cli/import/artifacts/resolver-kit.js";
import * as entitySpecs from "../../src/shared/io/generated/entity-specs.js";
import {
  buildFacadeForKind,
  isRegistryKind,
} from "../../src/cli/import/artifacts/facades/resolver-registry.js";

const cases = entitySpecs.RECORD_KINDS_IN_DEPENDENCY_ORDER.filter(
  isRegistryKind,
).flatMap((kind) => {
  const spec = (entitySpecs as Record<string, unknown>)[`${kind}CreateSpec`];
  if (!(spec instanceof z.ZodObject)) throw new Error(`Missing ${kind} schema`);
  return Object.entries(spec.shape).map(([field, schema]) => ({
    kind,
    field,
    nullable: (schema as z.ZodType).isNullable(),
  }));
});

// Exercise real registered resolvers. Adapters provide deterministic identities
// but never fabricate address data or a missing referenced record.
function testBackend() {
  return {
    findCanonicalId: async () => undefined,
    findOrCreateCanonicalId: async () => "canonical-id",
    businessKeyId: async (_key: string, resolve: () => Promise<string>) =>
      resolve(),
    findIdByBusinessKey: async () => undefined,
    mintId: () => "canonical-id",
    existingRow: async () => undefined,
    findForeignKeyTarget: () => undefined,
    getLocationPathByPath: async () => undefined,
    findRowsByColumns: async () => [],
    registerSlug: async () => {},
    ensureUniqueSlug: async () => "derived-slug",
    resolveAgencyCoordinates: async () => {
      throw new Error("Missing source address");
    },
    resolveAgencyLocation: async () => {
      throw new Error("Missing source location");
    },
  };
}

function facadeFor(kind: string) {
  return buildFacadeForKind(kind, {
    source: { namespace: "omission-test", name: "source", commandName: "test" },
    backend: testBackend(),
  });
}

test.each(cases)(
  "omitted $kind field $field never resolves to null",
  async ({ kind, field }) => {
    const result = await facadeFor(kind)
      .value(field)
      .then(
        (value) => ({ status: "resolved" as const, value }),
        (error) => ({ status: "rejected" as const, error }),
      );
    if (result.status === "resolved") expect(result.value).not.toBeNull();
    else {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error).not.toBeInstanceOf(TypeError);
    }
  },
);

test.each(cases.filter(({ nullable }) => nullable))(
  "explicit null remains null for $kind field $field",
  async ({ kind, field }) => {
    const facade = facadeFor(kind);
    facade.merge({ [field]: null });
    expect(await facade.value(field)).toBeNull();
  },
);

test.each([undefined, null])(
  "optional reference preserves %s directly",
  async (raw) => {
    const resolver = referenceResolver<
      Record<string, unknown>,
      string | null | undefined
    >("Entity", "parent", "Parent", () => undefined, { optional: true });
    const value = await resolver.resolve(
      {
        facade: { raw: () => raw, value: async () => raw },
        source: { namespace: "test", name: "record" },
        backend: testBackend(),
      },
      () => "missing parent",
    );
    expect(value).toBe(raw);
  },
);
