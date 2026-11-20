import { EventEmitter } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { watchCommandLogs } from "../../src/logging.js";

export async function readLogRecords(
  logPath: string,
): Promise<Record<string, unknown>[]> {
  const text = await readFile(logPath, "utf8");
  return text === ""
    ? []
    : text
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
}

// A command folder is named <timestamp>-<command-name>; the name has no "-".
export async function onlyCommandLog(
  workspace: string,
): Promise<{ folder: string; logPath: string }> {
  const commands = await readdir(path.join(workspace, "command"));
  if (commands.length !== 1)
    throw new Error(`Expected one command folder, found ${commands.length}.`);
  const folder = path.join(workspace, "command", commands[0]!);
  return {
    folder,
    logPath: path.join(folder, `${commands[0]!.split("-").at(-1)}.log`),
  };
}

// Ends every command log still open, as a process exit does, and reports
// whether the log at logPath was one of them.
export async function wasLogOpen(logPath: string): Promise<boolean> {
  const proc = Object.assign(new EventEmitter(), {
    pid: 0,
    kill: () => true,
  });
  watchCommandLogs(proc);
  const before = (await readLogRecords(logPath)).length;
  proc.emit("exit", 0);
  return (await readLogRecords(logPath)).length > before;
}
