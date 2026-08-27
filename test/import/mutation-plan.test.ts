import { describe, it, expect } from "vitest";
import { planDatabaseMutationItems } from "../../src/cli/import/artifacts/mutation-plan.js";
import type { DatabaseMutationEnvelope } from "../../src/cli/import/artifacts/io/DatabaseMutation.js";

// A LocationPathCreate envelope keyed on its (cuid) id, referencing its parent by
// the self-FK. The id is deliberately unrelated to the path so ordering can only
// come from the self-reference, not a lucky id sort.
function locationPath(
  id: string,
  parentId: string | null,
): DatabaseMutationEnvelope {
  return {
    apiVersion: "policeconduct.org/intake/v1alpha1",
    kind: "LocationPathCreate",
    metadata: { name: id, namespace: "test" },
    spec: {
      location_path_id: id,
      parent_location_path_id: parentId,
      path: `/${id}/`,
    },
  } as unknown as DatabaseMutationEnvelope;
}

describe("planDatabaseMutationItems self-referential ordering", () => {
  it("orders a self-referential kind root-down regardless of input order", () => {
    // Fed child-first; a stable id sort alone would keep it broken.
    const planned = planDatabaseMutationItems([
      locationPath("zzz-place", "mmm-county"),
      locationPath("aaa-state", null),
      locationPath("mmm-county", "aaa-state"),
    ]);
    const order = planned.map((item) =>
      "name" in item ? item.name : "",
    );
    // Every parent precedes its child.
    expect(order.indexOf("aaa-state")).toBeLessThan(order.indexOf("mmm-county"));
    expect(order.indexOf("mmm-county")).toBeLessThan(order.indexOf("zzz-place"));
  });

  it("handles several roots and deep chains", () => {
    const planned = planDatabaseMutationItems([
      locationPath("b-child", "b-root"),
      locationPath("a-grandchild", "a-child"),
      locationPath("a-child", "a-root"),
      locationPath("a-root", null),
      locationPath("b-root", null),
    ]).map((item) => ("name" in item ? item.name : ""));
    expect(planned.indexOf("a-root")).toBeLessThan(planned.indexOf("a-child"));
    expect(planned.indexOf("a-child")).toBeLessThan(
      planned.indexOf("a-grandchild"),
    );
    expect(planned.indexOf("b-root")).toBeLessThan(planned.indexOf("b-child"));
  });
});
