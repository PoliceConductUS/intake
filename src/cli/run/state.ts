import { mkdir } from "node:fs/promises";
import path from "node:path";
import { intakeWorkspace } from "../command-directory.js";

/**
 * Ensures and returns the durable, per-source state directory:
 * `${INTAKE_WORKSPACE}/intake/state/sources/${sourceId}/`.
 *
 * Unlike the per-run command workspace (see `command-directory.ts`), this
 * directory persists across runs. Sources use it for things like a
 * per-state hierarchy cache or a digest short-circuit, keyed by source id.
 */
export async function sourceStateDir(
  env: Record<string, string | undefined>,
  sourceId: string,
): Promise<string> {
  const workspace = intakeWorkspace(env);
  const stateDirectory = path.join(
    workspace,
    "intake",
    "state",
    "sources",
    sourceId,
  );

  try {
    await mkdir(stateDirectory, { recursive: true });
  } catch {
    throw new Error(`Source state directory is not writable: ${stateDirectory}`);
  }

  return stateDirectory;
}
