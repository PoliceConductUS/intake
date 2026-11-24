import { afterEach, expect, test, vi } from "vitest";
import { Command } from "commander";
import { registerCliCommand } from "../../../src/cli/sources/index.js";

const { secretsEnv, daily } = vi.hoisted(() => ({
  secretsEnv: { marker: "environment with Parameter Store secrets" },
  daily: vi.fn(async () => {}),
}));

vi.mock("../../../src/cli/parameter-store-env.js", () => ({
  withParameterStoreSecrets: () => secretsEnv,
}));
vi.mock("../../../src/cli/source-discovery.js", () => ({
  loadIntakeSource: async () => ({ daily }),
}));
afterEach(() => {
  vi.resetAllMocks();
});

test("sources daily gives the source's daily the Parameter Store environment", async () => {
  const program = new Command();
  registerCliCommand(program, { setResult: () => {} });
  await program.parseAsync(["sources", "daily", "org/example/search"], {
    from: "user",
  });
  expect(daily.mock.calls).toEqual([[secretsEnv]]);
});
