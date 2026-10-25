import path from "node:path";
import { Artifacts } from "../../src/shared/io/index.js";
import { completeTransform } from "../../src/cli/state/transform-completion.js";
import { importArtifacts as importCompleted } from "../../src/cli/import/artifacts/config.js";

/** Import-focused fixtures explicitly finish their authored artifact snapshot. */
export async function importArtifacts(
  input: Parameters<typeof importCompleted>[0],
) {
  const workspace =
    input.env?.INTAKE_WORKSPACE_TEST ?? input.env?.INTAKE_WORKSPACE;
  if (workspace === undefined)
    throw new Error("Import test fixture requires a workspace.");
  const artifacts = await Artifacts.read(input.artifactsPath, { raw: true });
  await completeTransform(
    path.join(workspace, "state", artifacts.metadata.namespace),
    input.artifactsPath,
    null,
  );
  return importCompleted(input);
}
