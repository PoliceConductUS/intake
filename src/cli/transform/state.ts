import { mkdir } from "node:fs/promises";
import path from "node:path";
import { intakeWorkspace } from "../command-directory.js";

export async function sourceStateDir(
  env: Record<string, string | undefined>,
  sourceId: string,
): Promise<string> {
  const workspace = intakeWorkspace(env);
  const stateDirectory = path.join(workspace, "state", sourceId);

  try {
    await mkdir(stateDirectory, { recursive: true });
  } catch {
    throw new Error(
      `Source state directory is not writable: ${stateDirectory}`,
    );
  }

  return stateDirectory;
}
