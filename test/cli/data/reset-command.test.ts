import { afterEach, expect, test, vi } from "vitest";
import { runIntake } from "../../../src/cli/index.js";
import { resetData } from "../../../src/cli/data/reset.js";

vi.mock("../../../src/cli/data/reset.js", () => ({
  resetData: vi.fn(async () => ({ exitCode: 0, stdout: "rebuilt\n" })),
}));
afterEach(() => vi.clearAllMocks());

test.each([
  { args: ["data", "reset", "--no-acquire"], acquire: false },
  { args: ["data", "reset"], acquire: true },
])("registers $args with acquire=$acquire", async ({ args, acquire }) => {
  expect(await runIntake(args)).toMatchObject({
    exitCode: 0,
    stdout: "rebuilt\n",
  });
  expect(resetData).toHaveBeenCalledWith(
    { acquire },
    expect.objectContaining({ env: process.env }),
  );
});

test("propagates a failed rebuild to the CLI exit status", async () => {
  vi.mocked(resetData).mockResolvedValueOnce({
    exitCode: 1,
    stderr: "rebuild incomplete\n",
  });
  expect(await runIntake(["data", "reset", "--no-acquire"])).toEqual({
    exitCode: 1,
    stderr: "rebuild incomplete\n",
  });
});
