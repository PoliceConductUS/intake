import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("retains 50,000 unresolved education facades within a 384 MiB heap", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      "--max-old-space-size=384",
      "--import",
      "tsx",
      fileURLToPath(
        new URL("./fixtures/construct-education-facades.ts", import.meta.url),
      ),
    ],
    { encoding: "utf8", timeout: 55_000 },
  );

  expect(result.error).toBeUndefined();
  expect(
    result.status,
    `${result.signal ?? ""}\n${result.stderr.slice(0, 1_000)}`,
  ).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    count: 50_000,
    lastName: "Training 49999",
  });
}, 60_000);
