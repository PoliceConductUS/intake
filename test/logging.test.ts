import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCommandLog, watchCommandLogs } from "../src/logging.js";
import { readLogRecords } from "./cli/command-log.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function openLog() {
  const commandDirectory = await mkdtemp(path.join(tmpdir(), "intake-log-"));
  const log = createCommandLog(
    { commandDirectory, commandName: "abc" },
    {},
    false,
  );
  cleanups.push(() => rm(commandDirectory, { recursive: true }));
  cleanups.push(() => log.close());
  return log;
}

function fakeProcess() {
  const proc = Object.assign(new EventEmitter(), {
    pid: 4242,
    killed: [] as [number, string][],
    kill(pid: number, signal: string) {
      proc.killed.push([pid, signal]);
      return true;
    },
  });
  watchCommandLogs(proc);
  return proc;
}

describe("a command log", () => {
  it("takes no record after it is closed", async () => {
    const log = await openLog();
    log.logger.info("before");
    log.close();
    log.logger.info("after");

    expect(
      (await readLogRecords(log.logPath)).map((record) => record.msg),
    ).toEqual(["before"]);
  });
});

describe("watchCommandLogs", () => {
  it("records the exit code in each log still open when the process exits", async () => {
    const proc = fakeProcess();
    const open = await openLog();
    const closed = await openLog();
    closed.close();

    proc.emit("exit", 13);

    const records = await readLogRecords(open.logPath);
    expect(records.at(-1)).toMatchObject({ level: 50, exitCode: 13 });
    expect(records.at(-1)).not.toHaveProperty("msg");
    expect(await readLogRecords(closed.logPath)).toEqual([]);
  });

  it.each(["SIGINT", "SIGTERM"])(
    "records %s, then ends the process with that signal",
    async (signal) => {
      const proc = fakeProcess();
      const log = await openLog();

      proc.emit(signal);

      expect((await readLogRecords(log.logPath)).at(-1)).toMatchObject({
        level: 50,
        signal,
      });
      expect(proc.listenerCount(signal)).toBe(0);
      expect(proc.killed).toEqual([[4242, signal]]);
    },
  );

  it("records an uncaught error with its message, stack and origin", async () => {
    const proc = fakeProcess();
    const log = await openLog();

    proc.emit(
      "uncaughtExceptionMonitor",
      new Error("lost connection"),
      "unhandledRejection",
    );

    const last = (await readLogRecords(log.logPath)).at(-1);
    expect(last).toMatchObject({
      level: 50,
      origin: "unhandledRejection",
      error: { type: "Error", message: "lost connection" },
    });
    expect(last).not.toHaveProperty("msg");
    expect((last!.error as { stack: string }).stack).toContain(
      "lost connection",
    );
  });

  it("writes one final record: a log ended by an uncaught error takes no exit record", async () => {
    const proc = fakeProcess();
    const log = await openLog();

    proc.emit(
      "uncaughtExceptionMonitor",
      new Error("boom"),
      "uncaughtException",
    );
    proc.emit("exit", 1);

    const records = await readLogRecords(log.logPath);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ origin: "uncaughtException" });
  });
});
