import { readFile } from "node:fs/promises";
import type { RegisterCliCommand } from "../../shared/cli/types.js";
import {
  defaultDatabaseClientFactory,
  type DatabaseClient,
} from "../database/index.js";
import { readLocationPathById } from "../database/location-paths.js";
import { migrateState, stringMap } from "./migrate-state.js";

export const registerCliCommand: RegisterCliCommand = (program, deps) => {
  program
    .command("workspace")
    .command("migrate-state")
    .description(
      "Copy private state into a separate workspace using verified namespace, command output and annotation identity maps.",
    )
    .requiredOption("--from <directory>")
    .requiredOption("--to <directory>")
    .requiredOption("--namespaces <file>")
    .requiredOption("--command-paths <file>")
    .requiredOption("--annotation-ids <file>")
    .action(
      async (args: {
        from: string;
        to: string;
        namespaces: string;
        commandPaths: string;
        annotationIds: string;
      }) => {
        const map = async (file: string) =>
          stringMap.parse(JSON.parse(await readFile(file, "utf8")));
        let connection: Promise<DatabaseClient> | undefined;
        try {
          const [namespaces, commandPaths, annotationIds] = await Promise.all(
            [args.namespaces, args.commandPaths, args.annotationIds].map(map),
          );
          const report = await migrateState({
            ...args,
            namespaces,
            commandPaths,
            annotationIds,
            progress: (count) =>
              process.stderr.write(
                "Migrated " + count + " private state files.\n",
              ),
            getLocationPathById: async (id) => {
              connection ??= (async () => {
                if (!process.env.DATABASE_URL)
                  throw Error(
                    "DATABASE_URL is required to verify agency place IDs.",
                  );
                const client = defaultDatabaseClientFactory(
                  process.env.DATABASE_URL,
                );
                await client.connect();
                return client;
              })();
              return readLocationPathById(await connection, id);
            },
          });
          deps.setResult({
            exitCode: 0,
            stdout: JSON.stringify(report, null, 2) + "\n",
          });
        } catch (error) {
          deps.setResult({ exitCode: 1, stderr: String(error) + "\n" });
        } finally {
          if (connection)
            await (await connection.catch(() => undefined))?.end();
        }
      },
    );
};
