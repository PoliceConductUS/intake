import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Command } from "../../shared/io/Command.js";
import { assertValidSourceId } from "../../shared/source-namespace.js";
import { hasCompletedAcquisition } from "../acquire/acquisition-completion.js";
import { readCommandPointer } from "../state/command-pointer.js";

async function isDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Retained outputs of successful acquire executions, in command order. */
export async function retainedAcquiredInputs(
  workspace: string,
  source: string,
): Promise<string[]> {
  assertValidSourceId(source);
  const { latest } = await readCommandPointer(
    path.join(workspace, "state", source),
    "acquire",
  );
  const chronological = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/;
  if (latest !== undefined) {
    const run = latest.split(path.sep)[1];
    if (
      !run ||
      !chronological.test(run) ||
      latest !== path.join("command", run, source, "output")
    ) {
      throw Error(`${source}: invalid acquisition path ${latest}.`);
    }
    if (!(await isDirectory(path.join(workspace, latest))))
      throw Error(`${source}: latest acquired output is missing: ${latest}.`);
  }
  const inputs: string[] = [];
  const commands = path.join(workspace, "command");
  const entries = await readdir(commands, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const relative = path.join("command", entry.name, source, "output");
    const output = path.join(workspace, relative);
    if (
      !(await hasCompletedAcquisition(output)) ||
      !(await isDirectory(output))
    )
      continue;
    const directory = path.join(workspace, "command", entry.name);
    const files = (await readdir(directory)).filter((name) =>
      name.endsWith(".Command.yaml"),
    );
    if (files.length !== 1)
      throw new Error(`Expected one Command envelope in ${directory}.`);
    const command = await Command.read(path.join(directory, files[0]));
    const args = command.spec.args;
    if (command.metadata.namespace !== source)
      throw new Error(`Command namespace mismatch in ${directory}.`);
    if (
      !(args[0] === "acquire" && args[1] === source) &&
      !(args[0] === "data" && args[1] === "acquire" && args[2] === source)
    )
      throw Error(
        `Completed acquisition refers to a different command at ${directory}.`,
      );
    if (!chronological.test(entry.name))
      throw new Error(
        `Acquisition has no chronological command name: ${entry.name}.`,
      );
    inputs.push(relative);
  }
  if (latest !== undefined && !inputs.includes(latest))
    throw new Error(
      `${source}: latest acquisition Command is missing or invalid: ${latest}.`,
    );
  if (!inputs.length) throw Error(`${source}: no completed acquisition.`);
  return inputs;
}
