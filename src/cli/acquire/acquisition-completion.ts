import { stat, writeFile } from "node:fs/promises";
import path from "node:path";

function receipt(output: string) {
  return path.join(path.dirname(output), "acquire-complete");
}

export async function recordCompletedAcquisition(output: string) {
  await writeFile(receipt(output), "", { flag: "wx" });
}

export async function hasCompletedAcquisition(output: string) {
  try {
    return (await stat(receipt(output))).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
