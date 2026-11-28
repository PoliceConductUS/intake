import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

let version: string | undefined;

/** The commit of intake that is running, recorded on each call outcome. */
export function intakeVersion(): string {
  version ??= execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return version;
}
