import { describe, it, expect } from "vitest";
import { acquire } from "../../../../../../sources/org/wikipedia/en/us-federal-law-enforcement-agencies/acquire.js";
import { unusedServiceClients } from "../../../../../shared/services/harness.js";

describe("org/wikipedia/en/us-federal-law-enforcement-agencies acquire", () => {
  it("throws for a blank FEDERAL_LE_PAGE_URL", async () => {
    await expect(
      acquire({
        clients: unusedServiceClients(),
        sourceDir: "/nonexistent/source",
        state: "/nonexistent/state",
        env: { FEDERAL_LE_PAGE_URL: " " },
        data: {} as never,
      }),
    ).rejects.toThrow(
      "org/wikipedia/en/us-federal-law-enforcement-agencies: FEDERAL_LE_PAGE_URL is set and blank",
    );
  });
});
