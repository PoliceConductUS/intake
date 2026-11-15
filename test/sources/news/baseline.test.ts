import { it, expect, vi } from "vitest";
import { recordOrigin } from "../../../src/cli/transform/source-transform.js";
import { buildFacadeForKind } from "../../../src/cli/import/artifacts/facades/resolver-registry.js";
import type { EntityFacadeBackend } from "../../../src/cli/import/artifacts/facades/entity-facade.js";
it("records a supplied source mapping when patching a known database article", async () => {
  const findOrCreateCanonicalId = vi.fn(async ({ resolve }) => resolve());
  const backend = {
    findRowsByColumns: async () => [{ id: "established" }],
    findOrCreateCanonicalId,
  } as unknown as EntityFacadeBackend;
  const facade = buildFacadeForKind("CoverageLink", {
    source: {
      action: "PATCH",
      selector: { id: "established" },
      name: "source",
      namespace: "com/serpapi/landing-page-search",
    },
    backend,
  });
  facade.merge({
    source_namespace: "com/serpapi/landing-page-search",
    source_id: "source",
    title: "existing",
  });
  expect(await facade.value("id")).toBe("established");
  expect(findOrCreateCanonicalId).toHaveBeenCalledWith(
    expect.objectContaining({
      namespace: "com/serpapi/landing-page-search",
      sourceId: "source",
      kind: "CoverageLink",
    }),
  );
});
it("validates a restored namespace by the same rules as an acquisition namespace", () =>
  expect(() =>
    recordOrigin({ source_namespace: "../out", source_id: "a" }),
  ).toThrow());
