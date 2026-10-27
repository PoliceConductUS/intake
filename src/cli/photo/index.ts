import type { Command } from "commander";
import type { CliCommandDependencies } from "../../shared/cli/types.js";
import { appendEntry } from "../state/manual-records.js";
import { defaultDatabaseClientFactory } from "../database/index.js";
import { readDatabaseRecordsByColumns } from "../database/entities.js";
import {
  intakeWorkspace,
  createCommandDirectory,
} from "../command-directory.js";
import { createSourceNameToCanonicalIdLedger } from "../state/source-name-to-canonical-id/index.js";
import { sourceStateDir } from "../transform/state.js";
import { preparePersonnelPhoto } from "./prepare.js";
import { storePersonnelPhoto } from "./store.js";

const namespace = "org.policeconduct.manual";
export function registerCliCommand(
  program: Command,
  dependencies: CliCommandDependencies,
) {
  program
    .command("photo")
    .description("Import local personnel portraits into intake.")
    .command("import")
    .argument("<personnel-id>", "exact existing canonical personnel ID")
    .argument("<file>", "local WebP, PNG, JPEG or AVIF image")
    .option("--source-url <url>", "verified source URL, when known")
    .action(
      async (
        personnelId: string,
        filename: string,
        options: { sourceUrl?: string },
      ) => {
        const env = process.env;
        try {
          const workspace = intakeWorkspace(env);
          if (!env.DATABASE_URL?.trim())
            throw new Error("DATABASE_URL is required for photo import.");
          if (options.sourceUrl !== undefined) new URL(options.sourceUrl);
          const client = defaultDatabaseClientFactory(env.DATABASE_URL);
          await client.connect();
          try {
            const ledger = createSourceNameToCanonicalIdLedger({
              rootDir: workspace,
            });
            const entry = await preparePersonnelPhoto(
              personnelId,
              filename,
              {
                findPersonnel: async (id) =>
                  (
                    await readDatabaseRecordsByColumns(
                      client,
                      "public.personnel",
                      { id },
                    )
                  ).length === 1,
                sourceIdFor: (id) =>
                  ledger.sourceIdFor(namespace, "Personnel", id),
                store: (file) => storePersonnelPhoto(workspace, file),
              },
              options.sourceUrl,
            );
            await createCommandDirectory(env, {
              namespace,
              args: [
                "photo",
                "import",
                personnelId,
                filename,
                ...(options.sourceUrl === undefined
                  ? []
                  : ["--source-url", options.sourceUrl]),
              ],
            });
            await appendEntry(
              await sourceStateDir(env, namespace),
              entry,
              "id",
            );
            dependencies.setResult({
              exitCode: 0,
              stdout: `Stored portrait for ${personnelId}.\nImport through the shared pipeline:\nnpm run cli -- data transform ${namespace}\nnpm run cli -- data generate ${namespace}\nnpm run cli -- data up\n`,
            });
          } finally {
            await client.end();
          }
        } catch (error) {
          dependencies.setResult({
            exitCode: 1,
            stderr: `${error instanceof Error ? error.message : String(error)}\n`,
          });
        }
      },
    );
}
