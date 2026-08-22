import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createId } from "@paralleldrive/cuid2";
import { Command } from "../shared/io/Command.js";

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function intakeWorkspace(
  env: Record<string, string | undefined>,
): string {
  const workspace = env.INTAKE_WORKSPACE_TEST ?? env.INTAKE_WORKSPACE;
  if (workspace === undefined || workspace.trim().length === 0) {
    throw new Error("INTAKE_WORKSPACE is required to create command output.");
  }
  return workspace;
}

export async function createCommandDirectory(
  env: Record<string, string | undefined>,
  options: {
    now?: Date;
    createCommandName?: () => string;
    args?: readonly string[];
    namespace?: string;
    sharedIoRoot?: string;
  } = {},
): Promise<{
  commandDirectory: string;
  commandName: string;
  commandPath: string;
  outputDirectory: string;
}> {
  const workspace = intakeWorkspace(env);
  const commandName = (options.createCommandName ?? createId)();
  const namespace = options.namespace ?? "intake";
  const commandDirectory = path.join(
    workspace,
    "command",
    `${timestampForPath(options.now ?? new Date())}-${encodeURIComponent(commandName)}`,
  );
  const outputDirectory = commandOutputDir(commandDirectory, namespace);

  try {
    await mkdir(outputDirectory, { recursive: true });
  } catch {
    throw new Error(`Command directory is not writable: ${commandDirectory}`);
  }

  const command = await Command.write(
    commandDirectory,
    Command.new({
      metadata: {
        name: commandName,
        namespace,
      },
      spec: {
        statePath: path.relative(
          commandDirectory,
          path.join(workspace, "state"),
        ),
        path: ".",
        sharedIoRoot:
          options.sharedIoRoot ??
          env.INTAKE_SHARED_IO_ROOT ??
          path.join(process.cwd(), "dist", "shared", "io"),
        args: [...(options.args ?? [])],
      },
    }),
  );

  return {
    commandDirectory,
    commandName,
    commandPath: command.path,
    outputDirectory,
  };
}

export function commandOutputDir(
  commandDirectory: string,
  namespace: string,
): string {
  return path.join(commandDirectory, namespace, "output");
}

export function commandNamespaceStateDir(
  commandDirectory: string,
  namespace: string,
): string {
  return path.join(commandDirectory, namespace, "state");
}
