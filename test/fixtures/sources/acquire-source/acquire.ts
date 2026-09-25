import { writeFile } from "node:fs/promises";
import path from "node:path";

export const acquire = async (deps: {
  sourceDir: string;
  logger?: { info: (message: string) => void };
}) => {
  await writeFile(
    path.join(deps.sourceDir, "roster.json"),
    JSON.stringify({ acquired: true }),
  );
  deps.logger?.info("acquire-source: wrote roster.json");
};
