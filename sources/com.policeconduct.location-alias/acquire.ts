import { createInterface } from "node:readline/promises";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/run/source-run.js";
import { appendAlias, locationPathFromUrl } from "./aliases.js";

// Ask on the terminal, unless the value is supplied via env (non-interactive /
// testable runs).
async function ask(
  envValue: string | undefined,
  question: string,
): Promise<string> {
  if (envValue !== undefined && envValue.trim() !== "") {
    return envValue.trim();
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

// Curated location aliases (ADR 0031). acquire prompts a human for one mistaken/
// alternate location URL and its canonical URL, appends the pair to the chained
// output in `state`, and records the previous output's path + sha so edits are
// detectable. run turns the latest output into LocationPathAlias artifacts.
export const acquire: SourceAcquire = async ({
  state,
  env,
  logger,
}: AcquireDeps): Promise<void> => {
  const aliasUrl = await ask(
    env.LOCATION_ALIAS_URL,
    "Alias URL (the mistaken/alternate location): ",
  );
  const canonicalUrl = await ask(
    env.LOCATION_CANONICAL_URL,
    "Canonical URL (the correct location): ",
  );
  if (aliasUrl === "" || canonicalUrl === "") {
    throw new Error(
      "com.policeconduct.location-alias: both an alias URL and a canonical URL are required.",
    );
  }
  const alias_path = locationPathFromUrl(aliasUrl);
  const location_path_id = locationPathFromUrl(canonicalUrl);
  if (alias_path === location_path_id) {
    throw new Error(
      `com.policeconduct.location-alias: the alias and canonical URLs resolve to the same path ${alias_path}.`,
    );
  }
  const output = await appendAlias(state, { alias_path, location_path_id });
  logger?.info(
    `com.policeconduct.location-alias: recorded ${alias_path} -> ${location_path_id} (${output.aliases.length} alias(es) total).`,
  );
};
