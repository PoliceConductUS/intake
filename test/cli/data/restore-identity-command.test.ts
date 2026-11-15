import { Command } from "commander";
import { expect, test, vi } from "vitest";
import { registerCliCommand } from "../../../src/cli/data/index.js";
import { generateIdentityRestorationEntry } from "../../../src/cli/data/chain.js";
vi.mock("../../../src/cli/data/chain.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  generateIdentityRestorationEntry: vi.fn(async () => ({
    written: "/tmp/event",
    version: "000001",
    mutationCount: 1,
  })),
}));
vi.mock("../../../src/cli/database/index.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  defaultDatabaseClientFactory: () => ({
    connect: async () => {},
    end: async () => {},
    query: async () => ({ rows: [] }),
  }),
}));
test("shared CLI requires evidence and passes explicit source identity and both IDs to generation", async () => {
  vi.stubEnv("DATABASE_URL", "postgres://test");
  const program = new Command().exitOverride();
  const setResult = vi.fn();
  registerCliCommand(program, { setResult });
  await program.parseAsync([
    "node",
    "intake",
    "data",
    "restore-identity",
    "test",
    "Agency",
    "source",
    "--expected-current-id",
    "wrong",
    "--original-id",
    "original",
    "--reason",
    "Restore published identity",
    "--evidence",
    "Published URL",
  ]);
  expect(generateIdentityRestorationEntry).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      kind: "IdentityRestoration",
      metadata: { name: "restore-identity", namespace: "test" },
      spec: {
        entityKind: "Agency",
        sourceName: "source",
        expectedCurrentId: "wrong",
        originalId: "original",
        reason: "Restore published identity",
        evidence: "Published URL",
      },
    }),
  );
  expect(setResult).toHaveBeenCalledWith(
    expect.objectContaining({ exitCode: 0 }),
  );
  vi.unstubAllEnvs();
});
