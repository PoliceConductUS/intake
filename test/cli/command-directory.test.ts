import { expect, it } from "vitest";
import { intakeWorkspace } from "../../src/cli/command-directory.js";

it("ignores INTAKE_WORKSPACE_TEST", () => {
  expect(
    intakeWorkspace({
      INTAKE_WORKSPACE: "/real",
      INTAKE_WORKSPACE_TEST: "/test",
    }),
  ).toBe("/real");
  expect(() => intakeWorkspace({ INTAKE_WORKSPACE_TEST: "/test" })).toThrow(
    "INTAKE_WORKSPACE is required to create command output.",
  );
});
