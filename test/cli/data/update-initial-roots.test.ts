import { afterEach, expect, test, vi } from "vitest";
import { Command } from "commander";
import { registerCliCommand } from "../../../src/cli/data/index.js";
import type { CommandResult } from "../../../src/shared/cli/types.js";
import { agencyTableIsEmpty } from "../../../src/cli/database/agency-graph.js";
import {
  generateOneSource,
  transformOneSource,
} from "../../../src/cli/data/source-pipeline.js";

vi.mock("../../../src/cli/database/index.js", () => ({
  defaultDatabaseClientFactory: () => ({
    connect: async () => {},
    end: async () => {},
  }),
}));
vi.mock("../../../src/cli/database/agency-graph.js", () => ({
  agencyTableIsEmpty: vi.fn(),
}));
vi.mock("../../../src/cli/data/chain.js", () => ({
  assertAtHead: async () => {},
  applyPending: async () => [],
}));
vi.mock("../../../src/cli/data/source-pipeline.js", () => ({
  orderedSourceIds: async () => ["first", "later"],
  transformOneSource: vi.fn(async () => ({
    artifactsPath: "source.Artifacts.yaml",
  })),
  generateOneSource: vi.fn(async () => ({ version: "1", mutationCount: 1 })),
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

test.each([true, false])(
  "update holds initial-root eligibility for the whole run (starts empty: %s)",
  async (startsEmpty) => {
    vi.stubEnv("DATABASE_URL", "postgresql://test");
    vi.mocked(agencyTableIsEmpty)
      .mockResolvedValueOnce(startsEmpty)
      .mockResolvedValue(false);
    vi.mocked(generateOneSource).mockResolvedValue({
      version: "1",
      mutationCount: 1,
    });
    const program = new Command();
    let result: CommandResult | undefined;
    registerCliCommand(program, {
      setResult: (value) => {
        result = value;
      },
    });
    await program.parseAsync(["data", "update"], { from: "user" });
    expect(result).toMatchObject({ exitCode: 0 });
    expect(agencyTableIsEmpty).toHaveBeenCalledTimes(1);
    expect(
      vi
        .mocked(generateOneSource)
        .mock.calls.map(([source, , initialRoots]) => [source, initialRoots]),
    ).toEqual([
      ["first", startsEmpty],
      ["later", startsEmpty],
    ]);
  },
);

test("update runs each source's transform with stderr as its terminal, so each writes and prints its command log", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://test");
  vi.mocked(agencyTableIsEmpty).mockResolvedValue(false);
  vi.mocked(transformOneSource).mockResolvedValue({
    artifactsPath: "source.Artifacts.yaml",
  });
  vi.mocked(generateOneSource).mockResolvedValue({
    version: "1",
    mutationCount: 1,
  });
  const program = new Command();
  registerCliCommand(program, { setResult: () => {} });
  await program.parseAsync(["data", "update"], { from: "user" });
  expect(
    vi
      .mocked(transformOneSource)
      .mock.calls.map(([source, , terminal]) => [source, terminal]),
  ).toEqual([
    ["first", process.stderr],
    ["later", process.stderr],
  ]);
});
