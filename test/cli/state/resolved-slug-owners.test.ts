import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import {
  createResolvedSlugOwnerLookup,
  writeResolvedProperty,
  readResolvedProperty,
} from "../../../src/cli/state/resolved-property/index.js";
import { DataContext } from "../../../src/cli/import/artifacts/data-context.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), "intake-slug-owners-"));
  roots.push(root);
  return root;
}
function put(
  rootDir: string,
  kind: string,
  name: string,
  value: unknown,
  targetProperty = "slug",
) {
  return writeResolvedProperty({
    rootDir,
    subject: { apiVersion: INTAKE_API_VERSION, kind, name },
    targetProperty,
    value,
  });
}

describe("canonical cache slug ownership", () => {
  it("finds every established owner for one kind, including names containing colons", async () => {
    const root = await workspace();
    await put(root, "Agency", "old-id", "published-agency");
    await put(root, "CivilCase", "court:case", "published-case");
    await put(root, "Agency", "coordinate-id", 30, "latitude");
    const lookup = createResolvedSlugOwnerLookup(root);
    expect(await lookup("Agency", "published-agency")).toBe("old-id");
    expect(await lookup("Agency", "published-case")).toBeUndefined();
    expect(await lookup("CivilCase", "published-case")).toBe("court:case");
  });

  it("memoizes a kind once per command instead of rescanning on every candidate", async () => {
    const root = await workspace();
    await put(root, "Agency", "old-id", "published-agency");
    const lookup = createResolvedSlugOwnerLookup(root);
    expect(await lookup("Agency", "published-agency")).toBe("old-id");
    await rm(path.join(root, "state"), { recursive: true });
    expect(await lookup("Agency", "published-agency")).toBe("old-id");
    expect(await lookup("Agency", "other")).toBeUndefined();
  });

  it("fails loudly if two canonical cache records own the same kind and slug", async () => {
    const root = await workspace();
    await put(root, "Agency", "first", "duplicate");
    await put(root, "Agency", "second", "duplicate");
    await expect(
      createResolvedSlugOwnerLookup(root)("Agency", "anything"),
    ).rejects.toThrow(/slug.*conflict/i);
  });

  it("rejects invalid cached slug values", async () => {
    const root = await workspace();
    await put(root, "Agency", "old-id", 12);
    await expect(
      createResolvedSlugOwnerLookup(root)("Agency", "anything"),
    ).rejects.toThrow(/invalid.*slug/i);
  });

  it("returns no owner when the workspace has no property cache", async () => {
    expect(
      await createResolvedSlugOwnerLookup(await workspace())("Agency", "new"),
    ).toBeUndefined();
  });

  it.each([false, true])(
    "reserves an absent entity's slug before new generation (old entity imported later: %s)",
    async (includeOld) => {
      const root = await workspace();
      await put(root, "Agency", "old-id", "published-agency");
      const context = new DataContext({
        ledger: {
          read: async (_namespace, _kind, name) => `${name}-id`,
          findOrCreate: async (_namespace, _kind, name) => `${name}-id`,
          sourceIdFor: async (_namespace, _kind, id) => id,
        },
        resolvedPropertyStore: {
          read: (input) => readResolvedProperty({ ...input, rootDir: root }),
          write: (input) => writeResolvedProperty({ ...input, rootDir: root }),
        },
        client: {
          connect: async () => undefined,
          query: async () => ({ rows: [] }),
          end: async () => undefined,
        },
        lookupCachedSlugOwner: createResolvedSlugOwnerLookup(root),
      });
      const incoming = context.facadeFromSource("Agency", {
        apiVersion: INTAKE_API_VERSION,
        namespace: "test",
        name: "new",
        canonicalId: "new-id",
        spec: { name: "Published Agency" },
      });
      expect(await incoming.value("slug")).toBe("published-agency-2");
      if (includeOld) {
        const old = context.facadeFromSource("Agency", {
          apiVersion: INTAKE_API_VERSION,
          namespace: "test",
          name: "old",
          canonicalId: "old-id",
          spec: { name: "Published Agency" },
        });
        expect(await old.value("slug")).toBe("published-agency");
      }
    },
  );
});
