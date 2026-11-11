import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Command } from "../../shared/io/Command.js";
import { readCommandPointer } from "../state/command-pointer.js";

async function isDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Retained snapshots through the latest completed acquisition, in acquisition order. */
export async function retainedAcquiredInputs(
  workspace: string,
  source: string,
): Promise<string[]> {
  const { latest, resume } = await readCommandPointer(
    path.join(workspace, "state", source),
    "acquire",
  );
  if (latest === undefined)
    throw new Error(`${source}: no completed acquisition.`);
  const parts = latest.split(path.sep);
  if (
    parts.length !== 4 ||
    parts[0] !== "command" ||
    parts[2] !== source ||
    parts[3] !== "output" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/.test(parts[1])
  )
    throw new Error(`${source}: invalid acquisition path ${latest}.`);
  if (!(await isDirectory(path.join(workspace, latest))))
    throw new Error(`${source}: latest acquired output is missing: ${latest}.`);
  const inputs: string[] = [];
  for (const entry of (
    await readdir(path.join(workspace, "command"), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name > parts[1]) continue;
    const relative = path.join("command", entry.name, source, "output");
    if (
      relative === resume ||
      !(await isDirectory(path.join(workspace, relative)))
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
      continue;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/.test(entry.name))
      throw new Error(
        `Acquisition has no chronological command name: ${entry.name}.`,
      );
    inputs.push(relative);
  }
  if (!inputs.includes(latest))
    throw new Error(
      `${source}: latest acquisition Command is missing or invalid: ${latest}.`,
    );
  return inputs;
}
