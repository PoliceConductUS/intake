import { Command } from "commander";
import { expect, test } from "vitest";
import { registerCliCommand } from "../../src/cli/requests/index.js";
test("requests exposes explicit submit force and read-only sync/status commands", () => {
  const program = new Command();
  registerCliCommand(program, { setResult: () => {} });
  const requests = program.commands.find(
    (command) => command.name() === "requests",
  )!;
  expect(requests.commands.map((command) => command.name())).toEqual([
    "submit",
    "status",
    "sync",
  ]);
  expect(
    requests.commands[0].options.some((option) => option.long === "--force"),
  ).toBe(true);
  expect(
    requests.commands[1].options.some((option) => option.long === "--json"),
  ).toBe(true);
});
test("invalid request source produces a clean nonzero command result", async () => {
  const program = new Command();
  let result: unknown;
  registerCliCommand(program, {
    setResult: (value) => {
      result = value;
    },
  });
  await program.parseAsync(["requests", "submit", "does-not-exist"], {
    from: "user",
  });
  expect(result).toMatchObject({
    exitCode: 1,
    stderr: expect.stringContaining("No request source"),
  });
});

import { afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as portal from "../../src/cli/requests/portal.js";
import * as responses from "../../src/cli/requests/responses.js";
import { RequestStore } from "../../src/cli/requests/lifecycle.js";
import type { CommandResult } from "../../src/shared/cli/types.js";
const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function fixture(extra: Record<string, unknown> = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "request-cli-"));
  temporary.push(directory);
  const definition = {
    agency: "Board",
    state: "AA",
    scope: "All records",
    channel: {
      type: "portal",
      url: "https://example.org/form",
      sourceUrl: "https://example.org",
    },
    historical: [
      {
        id: "abcdefghijklmnopqrstuvwx",
        submittedDate: "2026-01-01",
        transport: "portal",
        evidence: "receipt.txt",
        notes: "Confirmed",
      },
    ],
  };
  const form = {
    url: definition.channel.url,
    actions: [
      { type: "fill", target: { selector: "textarea" }, field: "requestText" },
    ],
    submit: { role: "button", name: "Submit" },
    successText: "Recorded",
    blockers: [],
    ...extra,
  };
  await mkdir(path.join(directory, "sources/gov.test"), { recursive: true });
  await mkdir(path.join(directory, "docs"));
  await writeFile(
    path.join(directory, "sources/gov.test/request.ts"),
    `export const request = ${JSON.stringify(definition)}; export const portalForm = ${JSON.stringify(form)};`,
  );
  await writeFile(
    path.join(directory, "docs/data-request-format.md"),
    "Complete standard request",
  );
  vi.spyOn(process, "cwd").mockReturnValue(directory);
  vi.stubEnv("INTAKE_WORKSPACE", directory);
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RECORDS_REQUEST_FROM", "sender@example.org");
  vi.stubEnv("RECORDS_REQUEST_RECEIVING_ADDRESS", "inbox@example.org");
  vi.stubEnv("RECORDS_REQUEST_REQUESTER", "Requester");
  vi.stubEnv(
    "RECORDS_REQUEST_CONTACT",
    JSON.stringify({
      firstName: "Dale",
      lastName: "Lotts",
      email: "inbox@example.org",
      phone: "5551234567",
      organization: "Institute",
      street: "123 Main",
      city: "Dallas",
      state: "Texas",
      zip: "75001",
    }),
  );
  return directory;
}
async function run(args: string[]) {
  let result: CommandResult | undefined;
  const program = new Command().exitOverride();
  registerCliCommand(program, {
    setResult(value) {
      result = value;
    },
  });
  await program.parseAsync(["requests", ...args], { from: "user" });
  return result;
}
test("portal CLI saves configured transport receipt without requiring an email sending key", async () => {
  const workspace = await fixture();
  const send = vi
    .spyOn(portal, "submitPortal")
    .mockImplementation(async (id, _payload, _profile, _form, options) => ({
      id: `portal-confirmation:${id}`,
      evidence: [
        path.join(options.evidenceDirectory, "portal-confirmation.json"),
      ],
    }));
  expect(await run(["submit", "gov.test", "--force"])).toMatchObject({
    exitCode: 0,
  });
  expect(send).toHaveBeenCalledOnce();
  const row = (await new RequestStore(workspace).list("gov.test")).find(
    (row) => row.spec.payload,
  )!;
  expect(row.spec.submission).toBe("submitted");
  expect(row.spec.evidence[0]).toContain("intake/state/namespaces/gov.test/");
});
test("portal CLI rejects unknown source form fields before transport", async () => {
  await fixture({ unexpected: true });
  const send = vi
    .spyOn(portal, "submitPortal")
    .mockRejectedValue(new Error("Unexpected transport call"));
  expect(await run(["submit", "gov.test", "--force"])).toMatchObject({
    exitCode: 1,
    stderr: expect.stringContaining("unexpected"),
  });
  expect(send).not.toHaveBeenCalled();
});
test("explicit sync association requires both IDs and a request in selected sources", async () => {
  await fixture();
  expect(
    await run(["sync", "gov.test", "--request-id", "abcdefghijklmnopqrstuvwx"]),
  ).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("together") });
  expect(
    await run([
      "sync",
      "gov.test",
      "--request-id",
      "bcdefghijklmnopqrstuvwxy",
      "--email-id",
      "email-1",
    ]),
  ).toMatchObject({
    exitCode: 1,
    stderr: expect.stringContaining("selected sources"),
  });
});
test("explicit sync association reaches synchronization with the chosen message and request", async () => {
  await fixture();
  vi.stubEnv("RESEND_API_KEY_FULL_ACCESS", "key");
  vi.stubEnv("ANTHROPIC_API_KEY", "key");
  vi.stubEnv("ANTHROPIC_MODEL", "model");
  const sync = vi.spyOn(responses, "syncMessages").mockResolvedValue([]);
  expect(
    await run([
      "sync",
      "gov.test",
      "--request-id",
      "abcdefghijklmnopqrstuvwx",
      "--email-id",
      "email-1",
    ]),
  ).toMatchObject({ exitCode: 0 });
  expect(sync.mock.calls[0][5]).toEqual({
    "email-1": "abcdefghijklmnopqrstuvwx",
  });
});

test("portal retries retain saved contact even when configured contact changes", async () => {
  const workspace = await fixture();
  const { SubmissionRejectedError } =
    await import("../../src/cli/requests/lifecycle.js");
  vi.spyOn(portal, "submitPortal")
    .mockRejectedValueOnce(new SubmissionRejectedError("Blocked before submit"))
    .mockImplementationOnce(async (id, _payload, profile) => {
      expect(profile.firstName).toBe("Dale");
      return { id: `portal-confirmation:${id}`, evidence: [] };
    });
  expect(await run(["submit", "gov.test", "--force"])).toMatchObject({
    exitCode: 1,
  });
  const saved = (await new RequestStore(workspace).list("gov.test")).find(
    (row) => row.spec.payload,
  )!;
  expect(saved.spec.payload?.portalContact?.firstName).toBe("Dale");
  const changed = JSON.parse(process.env.RECORDS_REQUEST_CONTACT!);
  changed.firstName = "Changed";
  vi.stubEnv("RECORDS_REQUEST_CONTACT", JSON.stringify(changed));
  expect(await run(["submit", "gov.test", "--force"])).toMatchObject({
    exitCode: 0,
  });
});
test("portal contact must route replies to the captured receiving address", async () => {
  await fixture();
  const changed = JSON.parse(process.env.RECORDS_REQUEST_CONTACT!);
  changed.email = "different@example.org";
  vi.stubEnv("RECORDS_REQUEST_CONTACT", JSON.stringify(changed));
  const send = vi
    .spyOn(portal, "submitPortal")
    .mockRejectedValue(new Error("Unexpected transport call"));
  expect(await run(["submit", "gov.test", "--force"])).toMatchObject({
    exitCode: 1,
    stderr: expect.stringContaining("receiving address"),
  });
  expect(send).not.toHaveBeenCalled();
});
