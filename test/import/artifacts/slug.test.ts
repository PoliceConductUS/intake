import { describe, expect, it } from "vitest";
import { SlugAllocator } from "../../../src/cli/import/artifacts/slug.js";

// A database-owner lookup that yields (one microtask) before answering, so
// concurrent ensureUnique calls interleave across the await — the window the
// check-then-claim race lived in.
function yieldingOwner(
  owners: Record<string, string> = {},
): (kind: string, slug: string) => Promise<string | undefined> {
  return async (_kind, slug) => {
    await Promise.resolve();
    return owners[slug];
  };
}

describe("SlugAllocator", () => {
  it("hands a second entity with the same base the next suffix", async () => {
    const allocator = new SlugAllocator(yieldingOwner());
    expect(
      await allocator.ensureUnique("Agency", {
        base: "smith",
        canonicalId: "a",
      }),
    ).toBe("smith");
    expect(
      await allocator.ensureUnique("Agency", {
        base: "smith",
        canonicalId: "b",
      }),
    ).toBe("smith-2");
  });

  it("returns the same slug for the same entity (idempotent)", async () => {
    const allocator = new SlugAllocator(yieldingOwner());
    const first = await allocator.ensureUnique("Agency", {
      base: "smith",
      canonicalId: "a",
    });
    const again = await allocator.ensureUnique("Agency", {
      base: "smith",
      canonicalId: "a",
    });
    expect(again).toBe(first);
  });

  it("skips a candidate already owned by a different entity in the database", async () => {
    const allocator = new SlugAllocator(
      yieldingOwner({ smith: "other-entity" }),
    );
    expect(
      await allocator.ensureUnique("Agency", {
        base: "smith",
        canonicalId: "a",
      }),
    ).toBe("smith-2");
  });

  it("gives concurrently-resolved entities with the same base distinct slugs", async () => {
    // The regression: both resolve through Promise.all across the yielding
    // database lookup. With the check-then-claim race they would both get
    // "smith"; the fix must hand out two distinct slugs.
    const allocator = new SlugAllocator(yieldingOwner());
    const [first, second] = await Promise.all([
      allocator.ensureUnique("Agency", { base: "smith", canonicalId: "a" }),
      allocator.ensureUnique("Agency", { base: "smith", canonicalId: "b" }),
    ]);
    expect(new Set([first, second]).size).toBe(2);
    expect(new Set([first, second])).toEqual(new Set(["smith", "smith-2"]));
  });

  it("keeps slugs independent across kinds", async () => {
    const allocator = new SlugAllocator(yieldingOwner());
    expect(
      await allocator.ensureUnique("Agency", {
        base: "smith",
        canonicalId: "a",
      }),
    ).toBe("smith");
    expect(
      await allocator.ensureUnique("Personnel", {
        base: "smith",
        canonicalId: "b",
      }),
    ).toBe("smith");
  });
});
