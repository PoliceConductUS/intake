import { afterEach, expect, test, vi } from "vitest";
import { Command } from "commander";
import { registerCliCommand } from "../../../src/cli/data/index.js";
import type { CommandResult } from "../../../src/shared/cli/types.js";
import { generateOneSource } from "../../../src/cli/data/source-pipeline.js";

const { secretsEnv } = vi.hoisted(() => ({
  secretsEnv: { marker: "environment with Parameter Store secrets" },
}));

vi.mock("../../../src/cli/parameter-store-env.js", () => ({
  withParameterStoreSecrets: () => secretsEnv,
}));
vi.mock("../../../src/cli/database/index.js", () => ({
  defaultDatabaseClientFactory: () => ({
    connect: async () => {},
    end: async () => {},
  }),
}));
vi.mock("../../../src/cli/database/agency-graph.js", () => ({
  agencyTableIsEmpty: async () => false,
}));
vi.mock("../../../src/cli/data/chain.js", () => ({
  assertAtHead: async () => {},
  applyPending: async () => [],
}));
vi.mock("../../../src/cli/data/source-pipeline.js", () => ({
  orderedSourceIds: async () => ["first", "later"],
  transformOneSource: async () => ({ artifactsPath: "source.Artifacts.yaml" }),
  generateOneSource: vi.fn(),
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

const SKIP =
  "courtlistener: went down at 2026-11-17T12:00:00.000Z; 3 call(s) skipped. Try again after 2026-11-17T13:00:00.000Z.";

async function run(
  args: string[],
  dependencies: { keepCachedCallResults?: boolean } = {},
): Promise<CommandResult> {
  vi.stubEnv("DATABASE_URL", "postgresql://test");
  const program = new Command();
  let result: CommandResult | undefined;
  registerCliCommand(program, {
    ...dependencies,
    setResult: (value) => {
      result = value;
    },
  });
  await program.parseAsync(args, { from: "user" });
  return result!;
}

test("generate gives the import the Parameter Store environment and ends by naming a service that went down", async () => {
  vi.mocked(generateOneSource).mockResolvedValue({
    version: "0007",
    mutationCount: 2,
    serviceSkips: [SKIP],
  });

  const result = await run(["data", "generate", "first"]);

  expect(vi.mocked(generateOneSource).mock.calls).toEqual([
    ["first", secretsEnv, undefined, undefined],
  ]);
  expect(result).toEqual({
    exitCode: 0,
    stdout: `data: appended 0007 (2 mutations).\n${SKIP}\n`,
  });
});

test("generate run by a reset without acquire keeps cached call results as they are", async () => {
  vi.mocked(generateOneSource).mockResolvedValue({
    mutationCount: 0,
    serviceSkips: [],
  });

  const result = await run(["data", "generate", "first"], {
    keepCachedCallResults: true,
  });

  expect(vi.mocked(generateOneSource).mock.calls[0][3]).toBe(true);
  expect(result).toEqual({
    exitCode: 0,
    stdout: "data: first — empty diff, nothing appended.\n",
  });
});

test("update gives every source's import the Parameter Store environment and exits zero after an outage", async () => {
  vi.mocked(generateOneSource)
    .mockResolvedValueOnce({ mutationCount: 0, serviceSkips: [SKIP] })
    .mockResolvedValue({ mutationCount: 0, serviceSkips: [] });

  const result = await run(["data", "update"]);

  expect(
    vi
      .mocked(generateOneSource)
      .mock.calls.map(([source, env]) => [source, env]),
  ).toEqual([
    ["first", secretsEnv],
    ["later", secretsEnv],
  ]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout?.trimEnd().split("\n").at(-1)).toBe(`first: ${SKIP}`);
});
