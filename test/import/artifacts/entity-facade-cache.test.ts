import { describe, expect, test } from "vitest";
import {
  Resolver,
  type FacadeSource,
  type PropertyCache,
  type ResolverContext,
} from "../../../src/cli/import/artifacts/resolver-kit.js";
import {
  EntityFacade,
  type EntityFacadeBackend,
  type MutationConstructors,
} from "../../../src/cli/import/artifacts/facades/entity-facade.js";

type Row = {
  id: string;
  coord: number;
  address: string;
  absent: string | null;
};

/** A hand-recorded cache so the test's oracle is independent of the facade. */
function recordingCache(seed: Record<string, unknown> = {}): PropertyCache & {
  reads: string[];
  writes: [string, unknown][];
  store: Map<string, unknown>;
} {
  const store = new Map(Object.entries(seed));
  const reads: string[] = [];
  const writes: [string, unknown][] = [];
  return {
    store,
    reads,
    writes,
    read: async (key) => {
      const cacheKey = `${key.kind}:${key.id}:${key.property}`;
      reads.push(cacheKey);
      return store.get(cacheKey);
    },
    write: async (key, value) => {
      const cacheKey = `${key.kind}:${key.id}:${key.property}`;
      writes.push([cacheKey, value]);
      store.set(cacheKey, value);
    },
  };
}

const stubBackend: EntityFacadeBackend = {
  findCanonicalId: async () => undefined,
  findOrCreateCanonicalId: async () => "unused",
  existingRow: async () => undefined,
  findForeignKeyTarget: () => undefined,
  getLocationPathByPath: async () => undefined,
};

// The cache tests never plan a mutation, so a create-only stub suffices.
const stubMutations = {
  create: { new: () => ({}) },
} as unknown as MutationConstructors<unknown>;

/** Build the merged engine directly from config, tracking live `coord` calls. */
function makeFacade(cache: PropertyCache | undefined): {
  facade: EntityFacade<Row, unknown, EntityFacadeBackend>;
  liveCoordCalls: () => number;
} {
  let liveCoordCalls = 0;
  const source: FacadeSource = { namespace: "test", name: "rec-1" };
  const resolvers = {
    id: new Resolver<string, ResolverContext<Row, EntityFacadeBackend>>(
      async () => "ent-1",
    ),
    coord: new Resolver<number, ResolverContext<Row, EntityFacadeBackend>>(
      async ({ facade }) => {
        liveCoordCalls += 1;
        // Resolves off `address`, so dependency ordering is exercised too.
        return (await facade.value("address")).length;
      },
    ),
    address: new Resolver<string, ResolverContext<Row, EntityFacadeBackend>>(
      async ({ facade }) => (facade.raw("address") as string) ?? "geocoded-st",
    ),
    // A cacheable resolver that yields "no value" (nullable column with nothing
    // to derive) — used to prove absence is never written to the cache.
    absent: new Resolver<
      string | null,
      ResolverContext<Row, EntityFacadeBackend>
    >(async () => null),
  };
  const facade = new EntityFacade<Row, unknown, EntityFacadeBackend>(
    "Widget",
    ["coord", "address", "absent"],
    resolvers,
    stubMutations,
    {
      source,
      backend: stubBackend,
      cache,
      // `coord`/`address`/`absent` are the resolved-during-import (cacheable) set;
      // `id` is excluded by the engine even if listed.
      cacheableProperties: ["id", "coord", "address", "absent"],
    },
  );
  return { facade, liveCoordCalls: () => liveCoordCalls };
}

describe("EntityFacade property cache", () => {
  test("a source-provided value wins and is never read from or written to the cache", async () => {
    const cache = recordingCache();
    const { facade } = makeFacade(cache);
    facade.merge({ address: "Main St" });

    expect(await facade.value("address")).toBe("Main St");
    expect(cache.reads).not.toContain("Widget:ent-1:address");
    expect(cache.writes).toHaveLength(0);
  });

  test("a cache hit short-circuits the resolver without resolving live", async () => {
    const cache = recordingCache({ "Widget:ent-1:coord": 99 });
    const { facade, liveCoordCalls } = makeFacade(cache);

    expect(await facade.value("coord")).toBe(99);
    expect(liveCoordCalls()).toBe(0);
    expect(cache.writes).toHaveLength(0);
  });

  test("a cache miss resolves live and writes the result back", async () => {
    const cache = recordingCache();
    const { facade, liveCoordCalls } = makeFacade(cache);
    // No source address -> address resolver falls back to "geocoded-st" (11 chars).

    expect(await facade.value("coord")).toBe(11);
    expect(liveCoordCalls()).toBe(1);
    expect(cache.writes).toContainEqual(["Widget:ent-1:coord", 11]);
    expect(cache.writes).toContainEqual([
      "Widget:ent-1:address",
      "geocoded-st",
    ]);
  });

  test("a live resolution of null is not written to the cache", async () => {
    const cache = recordingCache();
    const { facade } = makeFacade(cache);

    expect(await facade.value("absent")).toBeNull();
    expect(cache.writes).toHaveLength(0);
  });

  test("without a cache, cacheable resolvers still resolve live", async () => {
    const { facade, liveCoordCalls } = makeFacade(undefined);
    expect(await facade.value("coord")).toBe(11);
    expect(liveCoordCalls()).toBe(1);
  });
});
