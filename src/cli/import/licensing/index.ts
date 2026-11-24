import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { defaultDatabaseClientFactory } from "../../database/index.js";
import {
  readStateLocationPathId,
  replaceLocationReport,
} from "../../database/location-reports.js";
import type { CliCommandDependencies } from "../../../shared/cli/types.js";
import type { CommandResult } from "../../../shared/cli/types.js";
import {
  parseLicensingFile,
  planStateImport,
  type LicensingStatePlan,
} from "./plan.js";

type StateOutcome =
  | { state: string; outcome: "imported" }
  | { state: string; outcome: "planned" }
  | { state: string; outcome: "pending" }
  | { state: string; outcome: "failed"; error: string };

function reportWrite(plan: LicensingStatePlan) {
  return {
    id: plan.report.id,
    reportType: plan.report.reportType,
    reportKey: plan.report.reportKey,
    title: plan.report.title,
    summary: plan.report.summary,
    payloadJson: JSON.stringify(plan.report.payload),
    sortOrder: plan.report.sortOrder,
    status: plan.report.status,
    publishedAt: plan.report.publishedAt,
  };
}

export function registerCliCommand(
  importCommand: Command,
  dependencies: CliCommandDependencies,
): void {
  importCommand
    .command("licensing")
    .description(
      "Import committed state licensing summaries into DATABASE_URL.",
    )
    .argument(
      "[state-slugs...]",
      "state slugs to import (default: every state folder)",
    )
    .option(
      "--data-dir <path>",
      "licensing data directory",
      path.join("data", "licensing"),
    )
    .option("--dry-run", "print the per-state plan without writing")
    .action(
      async (
        stateSlugs: string[],
        options: { dataDir: string; dryRun?: boolean },
      ) => {
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
          dependencies.setResult({
            exitCode: 1,
            stderr: "DATABASE_URL is required to import licensing data.\n",
          });
          return;
        }

        const dataDir = path.resolve(options.dataDir);
        const entries = await readdir(dataDir, { withFileTypes: true });
        const availableStates = entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort();

        const unknownRequested = stateSlugs.filter(
          (slug) => !availableStates.includes(slug),
        );
        if (unknownRequested.length > 0) {
          dependencies.setResult({
            exitCode: 1,
            stderr: `No licensing folder for: ${unknownRequested.join(", ")}\n`,
          });
          return;
        }

        const selectedStates =
          stateSlugs.length > 0 ? stateSlugs : availableStates;
        const outcomes: StateOutcome[] = [];
        const client = defaultDatabaseClientFactory(databaseUrl);
        await client.connect();

        try {
          for (const state of selectedStates) {
            const filePath = path.join(dataDir, state, "licensing.json");
            const raw = await readFile(filePath, "utf8").catch(
              (cause: Error) => cause,
            );
            if (raw instanceof Error) {
              outcomes.push({
                state,
                outcome: "failed",
                error: raw.message,
              });
              continue;
            }

            const parsed = parseLicensingFile(raw);
            if ("error" in parsed) {
              outcomes.push({ state, outcome: "failed", error: parsed.error });
              continue;
            }
            if (parsed.file.state !== state) {
              outcomes.push({
                state,
                outcome: "failed",
                error: `file state "${parsed.file.state}" does not match folder "${state}"`,
              });
              continue;
            }
            if (parsed.file.status === "pending") {
              outcomes.push({ state, outcome: "pending" });
              continue;
            }

            const locationPathId = await readStateLocationPathId(client, state);
            if (!locationPathId) {
              outcomes.push({
                state,
                outcome: "failed",
                error: "no state-level location_path row",
              });
              continue;
            }

            const plan = planStateImport(parsed.file);
            if (options.dryRun) {
              outcomes.push({ state, outcome: "planned" });
              continue;
            }

            try {
              await replaceLocationReport(
                client,
                locationPathId,
                reportWrite(plan),
                plan.sources,
              );
              outcomes.push({ state, outcome: "imported" });
            } catch (cause) {
              outcomes.push({
                state,
                outcome: "failed",
                error: (cause as Error).message,
              });
            }
          }
        } finally {
          await client.end();
        }

        const imported = outcomes.filter((o) => o.outcome === "imported");
        const planned = outcomes.filter((o) => o.outcome === "planned");
        const pending = outcomes.filter((o) => o.outcome === "pending");
        const failed = outcomes.filter((o) => o.outcome === "failed");

        const stdoutLines: string[] = [];
        if (imported.length > 0) {
          stdoutLines.push(
            `imported: ${imported.map((o) => o.state).join(", ")}`,
          );
        }
        if (planned.length > 0) {
          stdoutLines.push(
            `planned (dry run): ${planned.map((o) => o.state).join(", ")}`,
          );
        }
        if (pending.length > 0) {
          stdoutLines.push(
            `skipped (pending): ${pending.map((o) => o.state).join(", ")}`,
          );
        }

        const result: CommandResult = {
          exitCode: failed.length > 0 ? 1 : 0,
          stdout: stdoutLines.length > 0 ? `${stdoutLines.join("\n")}\n` : "",
        };
        if (failed.length > 0) {
          result.stderr = `${failed
            .map(
              (o) =>
                `failed: ${o.state}: ${o.outcome === "failed" ? o.error : ""}`,
            )
            .join("\n")}\n`;
        }
        dependencies.setResult(result);
      },
    );
}
