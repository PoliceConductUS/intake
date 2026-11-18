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

export function createIntakeLog(
  options: CreateIntakeLogOptions = {},
): IntakeLog {
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

  return { logger, logPath };
}

export function createCommandLog(
  command: { commandDirectory: string; commandName: string },
  env: Record<string, string | undefined>,
  terminal: TerminalStream | false,
): IntakeLog {
  return createIntakeLog({
    logPath: path.join(command.commandDirectory, `${command.commandName}.log`),
    level: env.LOG_LEVEL,
    terminal,
  });
}

// A record without a message is written to the log file and not to the terminal.
export function recordCommandError(
  logger: CommandLogger,
  error: unknown,
): void {
  logger.error({ error: pino.stdSerializers.err(error as Error) });
}
