import { describe, expect, it } from "vitest";
import { buildFacadeForKind } from "../../../src/cli/import/artifacts/facades/resolver-registry.js";
import type { EntityFacadeBackend } from "../../../src/cli/import/artifacts/facades/entity-facade.js";
import type { SlugBackend } from "../../../src/cli/import/artifacts/facades/agency-personnel-resolvers.js";
import type { PropertyCache } from "../../../src/cli/import/artifacts/resolver-kit.js";
import { FederalAgencies } from "../../../src/shared/io/index.js";
import { FederalAgencyCreate } from "../../../src/cli/import/artifacts/io/generated-mutations/FederalAgencyCreate.js";
import { SlugAllocator } from "../../../src/cli/import/artifacts/slug.js";

const kinds = ["Agency", "Personnel", "CivilCase", "Review", "FederalAgency"];
function setup(kind: string, currentSlug?: string, cachedSlug?: string) {
  const values = new Map<string, unknown>();
  if (cachedSlug !== undefined) values.set("slug", cachedSlug);
  const allocator = new SlugAllocator(async () => undefined);
  const backend: EntityFacadeBackend & SlugBackend = {
    findCanonicalId: async () => "canonical-id",
    findOrCreateCanonicalId: async () => "canonical-id",
    businessKeyId: (_key, resolve) => resolve(),
    findIdByBusinessKey: async () => undefined,
    mintId: () => "canonical-id",
    existingRow: async () =>
      currentSlug === undefined
        ? undefined
        : { id: "canonical-id", slug: currentSlug },
    findForeignKeyTarget: () => undefined,
    getLocationPathByPath: async () => undefined,
    findRowsByColumns: async () => [],
    ensureUniqueSlug: ({ kind, base, canonicalId }) =>
      allocator.ensureUnique(kind, { base, canonicalId }),
    registerSlug: ({ kind, slug, canonicalId }) =>
      allocator.register(kind, slug, canonicalId),
  };
  const cache: PropertyCache = {
    read: async ({ property }) => values.get(property),
    write: async ({ property }, value) => {
      values.set(property, value);
    },
  };
  const facade = buildFacadeForKind(kind, {
    source: { namespace: "test", name: "source-name", commandName: "command" },
    backend,
    cache,
  });
  facade.merge({
    id: "canonical-id",
    name: "Changed Name",
    first_name: "Changed",
    last_name: "Name",
    title: "Changed Title",
    slug: "producer-slug",
  });
  return { facade, allocator, values };
}

describe.each(kinds)("%s canonical slugs", (kind) => {
  it("preserves and caches an established database slug despite producer input", async () => {
    const { facade, values } = setup(kind, "published-slug");
    expect(await facade.value("slug")).toBe("published-slug");
    expect(values.get("slug")).toBe("published-slug");
  });
  it("preserves a cached slug after reset and reserves it for this command", async () => {
    const { facade, allocator } = setup(kind, undefined, "published-slug");
    expect(await facade.value("slug")).toBe("published-slug");
    expect(
      await allocator.ensureUnique(kind, {
        base: "published-slug",
        canonicalId: "another-id",
      }),
    ).toBe("published-slug-2");
  });
  it("fails when canonical cache and database disagree", async () => {
    const { facade, values } = setup(
      kind,
      "published-slug",
      "conflicting-slug",
    );
    await expect(facade.value("slug")).rejects.toThrow(/slug.*conflict/i);
    expect(values.get("slug")).toBe("conflicting-slug");
  });
  it("assigns and caches a new intake slug independently of producer slug", async () => {
    const { facade, values } = setup(kind);
    const slug = await facade.value("slug");
    expect(slug).not.toBe("producer-slug");
    expect(slug).toBe(
      kind === "Personnel"
        ? "changed-name-icalid"
        : kind === "CivilCase" || kind === "Review"
          ? "changed-title"
          : "changed-name",
    );
    expect(values.get("slug")).toBe(slug);
  });
});

it("rejects two canonical entities claiming the same established slug", async () => {
  const allocator = new SlugAllocator(async () => undefined);
  await allocator.register("Agency", "published", "first");
  await expect(
    Promise.resolve().then(() =>
      allocator.register("Agency", "published", "second"),
    ),
  ).rejects.toThrow(/slug.*conflict/i);
});

it("rejects a restored cached slug owned by another database entity", async () => {
  const allocator = new SlugAllocator(async () => "other-id");
  await expect(
    Promise.resolve().then(() =>
      allocator.register("Agency", "published", "canonical-id"),
    ),
  ).rejects.toThrow(/slug.*conflict/i);
});

it("accepts a FederalAgency source without a slug while requiring a resolved Create slug", () => {
  const envelope = FederalAgencies.new({
    metadata: { namespace: "test", name: "agencies" },
    spec: {
      records: {
        agency: { spec: { name: "Federal Agency" } },
      },
    },
  });
  expect(Object.keys(envelope.spec.records)).toEqual(["agency"]);
  expect(() =>
    FederalAgencyCreate.schema.parse({
      apiVersion: "policeconduct.org/intake/v1alpha1",
      kind: "FederalAgencyCreate",
      metadata: { namespace: "test", name: "canonical-id" },
      spec: { id: "canonical-id", name: "Federal Agency" },
    }),
  ).toThrow();
});
