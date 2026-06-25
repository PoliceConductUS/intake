import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { Command } from "../../../src/shared/io/Command.js";

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "intake-command-"));
}

describe("Command IO", () => {
  test("writes and reads command envelopes with args through canonical IO", async () => {
    const directory = await tempDir();
    const written = await Command.write(
      directory,
      Command.new({
        metadata: {
          name: "s3gf94cl79h1xzjevdx1k39r",
          namespace: "us-census-gazetteer",
        },
        spec: {
          statePath: "../state",
          path: ".",
          sharedIoRoot: "/tmp/intake/dist/shared/io",
          args: ["artifacts", "create"],
        },
      }),
    );

    expect(path.basename(written.path)).toBe(
      "s3gf94cl79h1xzjevdx1k39r.Command.yaml",
    );
    await expect(Command.read(written.path)).resolves.toMatchObject({
      apiVersion: "policeconduct.org/intake/v1alpha1",
      kind: "Command",
      metadata: {
        name: "s3gf94cl79h1xzjevdx1k39r",
        namespace: "us-census-gazetteer",
      },
      spec: {
        statePath: "../state",
        path: ".",
        sharedIoRoot: "/tmp/intake/dist/shared/io",
        args: ["artifacts", "create"],
      },
    });
  });

  test("rejects metadata.runId", () => {
    expect(() =>
      Command.new({
        metadata: {
          runId: "s3gf94cl79h1xzjevdx1k39r",
          namespace: "us-census-gazetteer",
        },
        spec: {
          statePath: "../state",
          path: ".",
          sharedIoRoot: "/tmp/intake/dist/shared/io",
          args: ["artifacts", "create"],
        },
      } as never),
    ).toThrow("Command is malformed");
  });
});
