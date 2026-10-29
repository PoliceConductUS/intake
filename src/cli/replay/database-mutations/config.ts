import {
  type DatabaseClient,
  type DatabaseClientFactory,
  defaultDatabaseClientFactory,
} from "../../database/index.js";
import {
  type DatabaseMutationCounts,
  executeDatabaseMutations,
} from "./execute.js";

export type ReplayDatabaseMutationsResult =
  | { ok: true; counts: DatabaseMutationCounts }
  | { ok: false; error: string };

export type ReplayDatabaseMutationsCommandInput = {
  databaseMutationsPath: string;
  env?: Record<string, string | undefined>;
  clientFactory?: DatabaseClientFactory;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function closeClient(client: DatabaseClient): Promise<void> {
  try {
    await client.end();
  } catch {
    // Preserve the database operation error that triggered close.
  }
}

export async function replayDatabaseMutations(
  input: ReplayDatabaseMutationsCommandInput,
): Promise<ReplayDatabaseMutationsResult> {
  const databaseUrl = (input.env ?? process.env).DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    return {
      ok: false,
      error: "DATABASE_URL is required to replay DatabaseMutations.",
    };
  }

  const client = (input.clientFactory ?? defaultDatabaseClientFactory)(
    databaseUrl,
  );
  try {
    await client.connect();
    await client.query("begin");
    const counts = await executeDatabaseMutations(
      client,
      input.databaseMutationsPath,
    );
    await client.query("commit");
    return { ok: true, counts };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the database operation error that triggered rollback.
    }
    return { ok: false, error: errorMessage(error) };
  } finally {
    await closeClient(client);
  }
}
