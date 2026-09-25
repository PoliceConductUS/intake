import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export type CommandPointer = { resume?: string; latest?: string };

export async function readCommandPointer(
  statePath: string,
  command: string,
): Promise<CommandPointer> {
  try {
    const parsed =
      (parseYaml(
        await readFile(path.join(statePath, `${command}.yaml`), "utf8"),
      ) as CommandPointer | null) ?? {};
    return {
      resume: typeof parsed.resume === "string" ? parsed.resume : undefined,
      latest: typeof parsed.latest === "string" ? parsed.latest : undefined,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function writeCommandPointer(
  statePath: string,
  command: string,
  pointer: CommandPointer,
): Promise<void> {
  await mkdir(statePath, { recursive: true });
  const content: CommandPointer = {};
  if (pointer.latest) content.latest = pointer.latest;
  if (pointer.resume) content.resume = pointer.resume;
  await writeFile(
    path.join(statePath, `${command}.yaml`),
    stringifyYaml(content),
  );
}
