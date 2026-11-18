import { assertValidSourceId } from "../shared/source-namespace.js";
import { statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createId } from "@paralleldrive/cuid2";
import { Command } from "../shared/io/Command.js";
import { assertLogLevel } from "../logging.js";

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function intakeWorkspace(
  env: Record<string, string | undefined>,
): string {
  const name =
    env.INTAKE_WORKSPACE_TEST === undefined
      ? "INTAKE_WORKSPACE"
      : "INTAKE_WORKSPACE_TEST";
  const workspace = env[name];
  if (workspace === undefined || workspace.trim().length === 0) {
    throw new Error(
      `${name} is required: the absolute path of an existing workspace folder.`,
    );
  }
  if (!path.isAbsolute(workspace)) {
    throw new Error(`${name} must be an absolute path: ${workspace}`);
  }
  let stats;
  try {
    stats = statSync(workspace, { throwIfNoEntry: false });
  } catch (error) {
    throw new Error(
      `${name} ${workspace} cannot be read: ${(error as Error).message}`,
    );
  }
  if (!stats?.isDirectory()) {
    throw new Error(`${name} ${workspace} is not an existing folder.`);
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
  assertLogLevel(env);
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
  assertValidSourceId(namespace);
  return path.join(commandDirectory, namespace, "output");
}
