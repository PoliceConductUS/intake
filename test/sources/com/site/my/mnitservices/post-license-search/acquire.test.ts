import { describe, expect, it } from "vitest";
import { acquire } from "../../../../../../../sources/com/site/my/mnitservices/post-license-search/acquire.js";
import { unusedServiceClients } from "../../../../../../shared/services/harness.js";

describe("com/site/my/mnitservices/post-license-search acquire settings", () => {
  it("fails on a captcha wait that is not a number", async () => {
    await expect(
      acquire({
        clients: unusedServiceClients(),
        sourceDir: "/unused",
        state: "/unused",
        env: { MN_POST_CAPTCHA_WAIT_MS: "abc" },
        data: { agencies: async () => ({ items: [] }) },
      }),
    ).rejects.toThrow(/MN_POST_CAPTCHA_WAIT_MS is not a number: abc/);
  });
});
