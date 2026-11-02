import { expect, it } from "vitest";
import { planCaseSlugRows } from "../../src/cli/database/case-slugs.js";
const row = {
  id: "stable",
  title: "Example v. City",
  cause_number: "123",
  primary_source_url: "https://example.org/docket",
  court: "txnd",
  filed_date: "2025-01-02",
  full_citation: null,
  citation_source_url: null,
  slug: "old",
  state: "tx",
};
it("plans both old URL forms without changing identity", () => {
  const [change] = planCaseSlugRows([row]);
  expect(change?.id).toBe("stable");
  expect(change?.oldPaths).toEqual([
    "/civil-cases/old/",
    "/civil-litigation/tx/old/",
  ]);
  expect(change?.newSlug).toBe(
    "example-v-city-no-123-n-d-tex-filed-jan-2-2025",
  );
});
it("rejects collisions instead of assigning order-dependent suffixes", () => {
  expect(() =>
    planCaseSlugRows([row, { ...row, id: "other", slug: "other-old" }]),
  ).toThrow(/collision/i);
});
it("rejects takeover of another case's old URL", () => {
  expect(() =>
    planCaseSlugRows([
      row,
      {
        ...row,
        id: "other",
        title: "Other v. City",
        slug: "example-v-city-no-123-n-d-tex-filed-jan-2-2025",
      },
    ]),
  ).toThrow(/owned/i);
});
it("an already migrated case has no self-redirect", () => {
  const [first] = planCaseSlugRows([row]);
  const [second] = planCaseSlugRows([{ ...row, slug: first!.newSlug }]);
  expect(second?.oldPaths).toEqual([]);
});
