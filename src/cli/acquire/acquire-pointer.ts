import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export type AcquirePointer = { resume?: string; latest?: string };

const POINTER_FILE = "acquire.yaml";

export async function readAcquirePointer(
  statePath: string,
): Promise<AcquirePointer> {
  try {
    const parsed =
      (parseYaml(
        await readFile(path.join(statePath, POINTER_FILE), "utf8"),
      ) as AcquirePointer | null) ?? {};
    return {
      resume: typeof parsed.resume === "string" ? parsed.resume : undefined,
      latest: typeof parsed.latest === "string" ? parsed.latest : undefined,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function writeAcquirePointer(
  statePath: string,
  pointer: AcquirePointer,
): Promise<void> {
  await mkdir(statePath, { recursive: true });
  const content: AcquirePointer = {};
  if (pointer.latest) content.latest = pointer.latest;
  if (pointer.resume) content.resume = pointer.resume;
  await writeFile(path.join(statePath, POINTER_FILE), stringifyYaml(content));
}
