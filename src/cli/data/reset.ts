import { spawn } from "node:child_process";
import { rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandResult } from "../../shared/cli/types.js";
import type { ImportArtifactKind } from "../../shared/io/index.js";
import {
  createCommandDirectory,
  intakeWorkspace,
} from "../command-directory.js";
import { orderedSourceIds, transformOneSource } from "./source-pipeline.js";

import { retainedAcquiredInputs } from "./acquired-inputs.js";
import {
  loadSourceProduces,
  loadSourceStandalone,
} from "../transform/load-source-module.js";
import {
  readCommandPointer,
  writeCommandPointer,
} from "../state/command-pointer.js";

type ResetOptions = { acquire: boolean };
type ResetDependencies = {
  env: Record<string, string | undefined>;
  logger: { info(message: string): void };
  orderedSourceIds?: () => Promise<string[]>;
  acquiredInputs?: (source: string) => Promise<string[] | null>;
  sourceProduces?: (source: string) => Promise<readonly ImportArtifactKind[]>;
  resetDatabase?: (env: Record<string, string | undefined>) => Promise<void>;
  runDataCommand?: (
    args: readonly string[],
    context?: {
      useInitialAgencyRoots: boolean;
    },
  ) => Promise<CommandResult>;
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
      (async (args, context) => {
        const { runIntake } = await import("../run-intake.js");
        return runIntake(args, context);
      });

    const executePhase = async (args: string[]) => {
      phase = args.join(" ");
      logger.info(`data reset: ${phase}`);
      const result = await runDataCommand(args, {
        useInitialAgencyRoots: true,
      });
      if (result.exitCode !== 0)
        throw new Error(result.stderr?.trim() || `${phase} failed.`);
      if (result.stdout?.trim()) logger.info(result.stdout.trim());
    };
    const acquiredInputs =
      dependencies.acquiredInputs ??
      (async (id: string) =>
        (await loadSourceStandalone(id, path.join(process.cwd(), "sources")))
          ? null
          : retainedAcquiredInputs(workspace, id));

    for (const source of sources) {
      phase = `inventory acquisitions ${source}`;
      const state = path.join(workspace, "state", source);
      const pointer = await readCommandPointer(state, "acquire");
      if (options.acquire && pointer.latest === undefined) continue;
      const inputs = await acquiredInputs(source);
      if (inputs === null) continue;
      try {
        for (const input of inputs) {
          await writeCommandPointer(state, "acquire", {
            ...pointer,
            latest: input,
          });
          await executePhase(["data", "transform", source]);
        }
      } finally {
        await writeCommandPointer(state, "acquire", pointer);
      }
    }

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

    const rebuildSource = async (source: string) => {
      phase = `inventory acquisitions ${source}`;
      const inputs = await acquiredInputs(source);
      const state = path.join(workspace, "state", source);
      const pointer =
        inputs === null ? null : await readCommandPointer(state, "acquire");
      try {
        for (const input of inputs ?? [null]) {
          if (input !== null) {
            logger.info(`data reset: replaying ${source} acquisition ${input}`);
            await writeCommandPointer(state, "acquire", {
              ...pointer,
              latest: input,
            });
          }
          for (const action of ["transform", "generate", "up"]) {
            await executePhase(
              action === "up" ? ["data", action] : ["data", action, source],
            );
          }
        }
      } finally {
        if (pointer !== null)
          await writeCommandPointer(state, "acquire", pointer);
      }
    };
    const sourceProduces =
      dependencies.sourceProduces ??
      ((id: string) =>
        loadSourceProduces(id, path.join(process.cwd(), "sources")));
    let lastLocationProducer: string | undefined;
    for (const source of sources) {
      if ((await sourceProduces(source)).includes("LocationPaths"))
        lastLocationProducer = source;
    }
    for (const source of sources) {
      if (options.acquire) await executePhase(["data", "acquire", source]);
      await rebuildSource(source);
      if (source === lastLocationProducer) {
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
    await rebuildSource("org.policeconduct.manual");
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
