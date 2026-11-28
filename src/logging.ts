import type { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import path from "node:path";
import pino, {
  type DestinationStream,
  type Logger,
  type StreamEntry,
} from "pino";

export type TerminalStream = {
  write(text: string): unknown;
};

export type CommandLogger = Pick<Logger, "info" | "error">;

export type IntakeLog = {
  logger: Logger;
  logPath: string;
  close(): void;
};

type CreateIntakeLogOptions = {
  logPath?: string;
  level?: string;
  terminal?: TerminalStream | false;
};

function createTerminalLogStream(terminal: TerminalStream): DestinationStream {
  return {
    write(text: string): void {
      const record = JSON.parse(text) as { msg?: unknown };
      if (typeof record.msg === "string") {
        terminal.write(`${record.msg}\n`);
      }
    },
  };
}

function createIntakeLog(options: CreateIntakeLogOptions = {}): IntakeLog {
  const logPath = options.logPath;
  if (logPath === undefined || logPath.trim().length === 0) {
    throw new Error("Command log path is required to write intake logs.");
  }

  const logDir = path.dirname(logPath);
  const level = options.level ?? "info";

  mkdirSync(logDir, { recursive: true });

  const destination = pino.destination({
    dest: logPath,
    sync: true,
    append: true,
  });
  const streams: StreamEntry[] = [{ level: "trace", stream: destination }];
  if (options.terminal !== false) {
    streams.push({
      level: "trace",
      stream: createTerminalLogStream(options.terminal ?? process.stdout),
    });
  }
  const logger = pino(
    {
      base: null,
      level,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams),
  );

  return {
    logger,
    logPath,
    close() {
      logger.level = "silent";
      destination.end();
    },
  };
}

const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const;

export function assertLogLevel(env: Record<string, string | undefined>): void {
  const level = env.LOG_LEVEL;
  if (level !== undefined && !(LOG_LEVELS as readonly string[]).includes(level))
    throw new Error(
      `LOG_LEVEL ${JSON.stringify(level)} is not a log level. Use one of: ${LOG_LEVELS.join(", ")}.`,
    );
}

const openCommandLogs = new Set<IntakeLog>();

export function createCommandLog(
  command: { commandDirectory: string; commandName: string },
  env: Record<string, string | undefined>,
  terminal: TerminalStream | false,
): IntakeLog {
  const log = createIntakeLog({
    logPath: path.join(command.commandDirectory, `${command.commandName}.log`),
    level: env.LOG_LEVEL,
    terminal,
  });
  const commandLog: IntakeLog = {
    logger: log.logger,
    logPath: log.logPath,
    close() {
      if (!openCommandLogs.delete(commandLog)) return;
      log.close();
    },
  };
  openCommandLogs.add(commandLog);
  return commandLog;
}

function endOpenCommandLogs(record: Record<string, unknown>): void {
  for (const log of [...openCommandLogs]) {
    log.logger.error(record);
    log.close();
  }
}

type WatchedProcess = Pick<EventEmitter, "on" | "removeListener"> & {
  pid: number;
  kill(pid: number, signal: string): unknown;
};

// ADR 0013: a process that ends while a command log is open records why in that log.
export function watchCommandLogs(proc: WatchedProcess): void {
  proc.on("exit", (exitCode: number) => endOpenCommandLogs({ exitCode }));
  proc.on("uncaughtExceptionMonitor", (error: unknown, origin: string) =>
    endOpenCommandLogs({
      error: pino.stdSerializers.err(error as Error),
      origin,
    }),
  );
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const onSignal = () => {
      endOpenCommandLogs({ signal });
      proc.removeListener(signal, onSignal);
      proc.kill(proc.pid, signal);
    };
    proc.on(signal, onSignal);
  }
}

// A record without a message is written to the log file and not to the terminal.
export function recordCommandError(
  logger: CommandLogger,
  error: unknown,
): void {
  logger.error({ error: pino.stdSerializers.err(error as Error) });
}
