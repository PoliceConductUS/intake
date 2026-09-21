import { spawn } from "node:child_process";
import { rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandResult } from "../../shared/cli/types.js";
import {
  createCommandDirectory,
  intakeWorkspace,
} from "../command-directory.js";
import { orderedSourceIds, transformOneSource } from "./source-pipeline.js";

type ResetOptions = { acquire: boolean };
type ResetDependencies = {
  env: Record<string, string | undefined>;
  logger: { info(message: string): void };
  orderedSourceIds?: () => Promise<string[]>;
  resetDatabase?: (env: Record<string, string | undefined>) => Promise<void>;
  runDataCommand?: (args: readonly string[]) => Promise<CommandResult>;
  prepareManualLocations?: () => Promise<CommandResult>;
};

/** Reset the same database that subsequent intake commands will populate. */
export async function resetConfiguredDatabase(
  env: Record<string, string | undefined>,
): Promise<void> {
  const binary = fileURLToPath(
    new URL("../../../node_modules/.bin/supabase", import.meta.url),
  );
  const target = new URL(env.DATABASE_URL!);
  // Supabase's --db-url assumes TLS, unlike the local Postgres connection.
  if (
    ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
    !target.searchParams.has("sslmode")
  ) {
    target.searchParams.set("sslmode", "disable");
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      binary,
      ["db", "reset", "--db-url", target.toString(), "--no-seed", "--yes"],
      {
        env: {
          ...process.env,
          ...env,
          ...(target.searchParams.has("sslmode")
            ? { PGSSLMODE: target.searchParams.get("sslmode")! }
            : {}),
          SUPABASE_TELEMETRY_DISABLED: "1",
        },
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(new Error(`Schema reset failed (${signal ?? `exit ${code}`}).`));
    });
  });
}

export async function resetData(
  options: ResetOptions,
  dependencies: ResetDependencies,
): Promise<CommandResult> {
  const { env, logger } = dependencies;
  let phase = "preparation";
  try {
    const workspace = intakeWorkspace(env);
    if (!env.DATABASE_URL?.trim())
      throw new Error("DATABASE_URL is required for data reset.");
    const sources = await (dependencies.orderedSourceIds ?? orderedSourceIds)();
    const command = await createCommandDirectory(env, {
      args: ["data", "reset", ...(options.acquire ? [] : ["--no-acquire"])],
    });
    const runDataCommand =
      dependencies.runDataCommand ??
      (async (args) => {
        const { runIntake } = await import("../index.js");
        return runIntake(args);
      });

    phase = "schema reset";
    logger.info(
      "data reset: resetting the configured database to current migrations.",
    );
    await (dependencies.resetDatabase ?? resetConfiguredDatabase)(env);

    phase = "retiring previous mutations";
    const previous = path.join(command.outputDirectory, "previous-mutations");
    try {
      await rename(path.join(workspace, "data", "mutations"), previous);
      logger.info(`data reset: previous mutations retained at ${previous}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const executePhase = async (args: string[]) => {
      phase = args.join(" ");
      logger.info(`data reset: ${phase}`);
      const result = await runDataCommand(args);
      if (result.exitCode !== 0)
        throw new Error(result.stderr?.trim() || `${phase} failed.`);
      if (result.stdout?.trim()) logger.info(result.stdout.trim());
    };
    for (const source of [...sources, "org.policeconduct.manual"]) {
      const phases = [
        ...(options.acquire && source !== "org.policeconduct.manual"
          ? [["data", "acquire", source]]
          : []),
        ["data", "transform", source],
        ["data", "generate", source],
        ["data", "up"],
      ];
      for (const args of phases) {
        await executePhase(args);
      }
      if (source === "us-census-gazetteer") {
        phase = "preparing manual locations";
        logger.info(`data reset: ${phase}`);
        const prepared = await (
          dependencies.prepareManualLocations ??
          (async () => {
            const result = await transformOneSource(
              "org.policeconduct.manual",
              env,
              logger,
              ["LocationPaths", "LocationPathAliases"],
            );
            return "error" in result ? result.error : { exitCode: 0 };
          })
        )();
        if (prepared.exitCode !== 0)
          throw new Error(
            prepared.stderr?.trim() || "Manual location preparation failed.",
          );
        await executePhase(["data", "generate", "org.policeconduct.manual"]);
        await executePhase(["data", "up"]);
      }
    }
    return {
      exitCode: 0,
      stdout: `data reset: rebuilt ${sources.length} source(s) and manual records${options.acquire ? "" : " without acquisition"}.\n`,
    };
  } catch (error) {
    return {
      exitCode: 1,
      stderr: `data reset: rebuild incomplete at ${phase}: ${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}
