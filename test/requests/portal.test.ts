import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  submitPortal,
  type PortalPage,
  type PortalForm,
} from "../../src/cli/requests/portal.js";
import { SubmissionRejectedError } from "../../src/cli/requests/lifecycle.js";
const profile = {
  firstName: "Dale",
  lastName: "Lotts",
  email: "reply@example.org",
  phone: "5551234567",
  organization: "Institute",
  street: "123 Main",
  city: "Dallas",
  state: "Texas",
  zip: "75001",
};
const payload = {
  from: "hello@example.org",
  to: "https://example.org/form",
  reply_to: "reply@example.org",
  subject: "Request [identity]",
  text: "Agency scope\nRequest ID: identity",
  attachments: [
    {
      filename: "request.md",
      content: Buffer.from("Complete standard\nLast paragraph.").toString(
        "base64",
      ),
    },
  ],
};
const form: PortalForm = {
  url: payload.to,
  actions: [
    { type: "fill", target: { selector: "#first" }, field: "firstName" },
    { type: "click", target: { role: "checkbox", name: "Other" } },
    { type: "fill", target: { selector: "#request" }, field: "requestText" },
  ],
  submit: { role: "button", name: "Submit" },
  successText: "Your response has been recorded.",
  blockers: [{ selector: "#captcha" }],
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fixture(
  options: { truncated?: boolean; blocked?: boolean; confirmed?: boolean } = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), "portal-test-"));
  directories.push(directory);
  const fields = new Map<string, string>();
  let submitted = false;
  let closed = false;
  function locator(key: string) {
    return {
      async fill(value: string) {
        fields.set(key, options.truncated ? value.slice(0, 3) : value);
      },
      async inputValue() {
        return fields.get(key) ?? "";
      },
      async click() {
        if (key === "Submit") submitted = true;
      },
      async selectOption() {},
      async isVisible() {
        return key === "#captcha"
          ? !!options.blocked
          : submitted && options.confirmed !== false;
      },
      async waitFor() {
        if (!submitted || options.confirmed === false)
          throw new Error("Confirmation timed out");
      },
      async innerText() {
        return "Your response has been recorded.";
      },
    };
  }
  const page: PortalPage = {
    async goto() {},
    locator,
    getByLabel: locator,
    getByRole(_role, o) {
      return locator(o.name);
    },
    getByText: locator,
    url: () => payload.to,
    async screenshot() {
      return Buffer.from("screenshot");
    },
  };
  return {
    fields,
    directory,
    submitted: () => submitted,
    closed: () => closed,
    openBrowser: async () => ({
      page,
      close: async () => {
        closed = true;
      },
    }),
  };
}
test("portal submits full standard text and saves observed confirmation without an agency ID", async () => {
  const f = await fixture();
  const receipt = await submitPortal("identity", payload, profile, form, {
    evidenceDirectory: f.directory,
    openBrowser: f.openBrowser,
  });
  expect(f.fields.get("#request")).toBe(
    "Request [identity]\n\nAgency scope\nRequest ID: identity\n\nComplete standard\nLast paragraph.",
  );
  expect(f.fields.get("#first")).toBe("Dale");
  expect(f.submitted()).toBe(true);
  expect(receipt.id).toBe("portal-confirmation:identity");
  expect(JSON.parse(await readFile(receipt.evidence[0], "utf8"))).toMatchObject(
    { requestId: "identity", url: payload.to, confirmation: form.successText },
  );
  expect(await readFile(receipt.evidence[1], "utf8")).toBe("screenshot");
  expect(f.closed()).toBe(true);
});
test.each([{ truncated: true }, { blocked: true }])(
  "portal rejects incomplete fields or CAPTCHA before submit: %j",
  async (options) => {
    const f = await fixture(options);
    await expect(
      submitPortal("identity", payload, profile, form, {
        evidenceDirectory: f.directory,
        openBrowser: f.openBrowser,
      }),
    ).rejects.toBeInstanceOf(SubmissionRejectedError);
    expect(f.submitted()).toBe(false);
    expect(f.closed()).toBe(true);
  },
);
test("missing confirmation after click remains uncertain", async () => {
  const f = await fixture({ confirmed: false });
  let error: unknown;
  try {
    await submitPortal("identity", payload, profile, form, {
      evidenceDirectory: f.directory,
      openBrowser: f.openBrowser,
    });
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(SubmissionRejectedError);
  expect(f.submitted()).toBe(true);
  expect(f.closed()).toBe(true);
});
