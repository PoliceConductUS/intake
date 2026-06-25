import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ArtifactsEnvelope } from "../../../shared/io/Artifacts.js";
import { DatabaseMutations } from "./io/DatabaseMutations.js";

function intakeCommandRoot(
  env: Record<string, string | undefined>,
): string | undefined {
  const workspace = env.INTAKE_WORKSPACE_TEST ?? env.INTAKE_WORKSPACE;
  if (workspace === undefined || workspace.trim().length === 0) {
    return undefined;
  }

  return path.join(workspace, "intake", "commands");
}

export async function assertNoExistingImport(
  artifacts: ArtifactsEnvelope,
  options: { env?: Record<string, string | undefined> } = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const commandRoot = intakeCommandRoot(env);
  if (commandRoot === undefined) {
    return;
  }

  const existingImport = await findExistingImportPath(
    commandRoot,
    artifacts.metadata.namespace,
    artifacts.metadata.name,
  );
  if (existingImport !== undefined) {
    throw existingImportError(artifacts.metadata.name, existingImport);
  }
}

async function existingImportCandidate(
  filePath: string,
  namespace: string,
  sourceArtifactsName: string,
): Promise<boolean> {
  const resource = await DatabaseMutations.read(filePath, { raw: true });
  return (
    resource.metadata.namespace === namespace &&
    resource.metadata.sourceArtifactsName === sourceArtifactsName
  );
}

async function findExistingImportPath(
  commandRoot: string,
  namespace: string,
  sourceArtifactsName: string,
): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(commandRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    const entryPath = path.join(commandRoot, entry.name);
    const candidateFiles = entry.isDirectory()
      ? await readdir(entryPath).catch(() => [])
      : [entry.name];
    for (const fileName of candidateFiles) {
      if (!fileName.endsWith(".DatabaseMutations.yaml")) {
        continue;
      }
      const filePath = entry.isDirectory()
        ? path.join(entryPath, fileName)
        : entryPath;
      if (
        await existingImportCandidate(filePath, namespace, sourceArtifactsName)
      ) {
        return filePath;
      }
    }
  }

  return undefined;
}

function existingImportError(
  sourceArtifactsName: string,
  existingImportPath: string,
): Error {
  return new Error(
    [
      `DatabaseMutations already exists for source Artifacts ${sourceArtifactsName}: ${existingImportPath}`,
      `Replay the existing DatabaseMutations with: intake replay database-mutations ${existingImportPath}`,
    ].join("\n"),
  );
}
