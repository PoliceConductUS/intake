import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  yamlDigest,
  yamlResourceFileName,
} from "../../../shared/io/resource.js";

export async function ledgerRecordPath(
  directory: string,
  name: string,
  kind: "SourceNameToCanonicalId" | "CanonicalIdToSourceName",
): Promise<string> {
  const filename = yamlResourceFileName(name, kind);
  const ordinary = path.join(directory, filename);
  if (!/^https?:\/\//i.test(name)) return ordinary;
  const digestPath = path.join(
    directory,
    "%url-" + yamlDigest(name) + "." + kind + ".yaml",
  );
  if (Buffer.byteLength(filename) > 255) return digestPath;
  try {
    const actual = await realpath(ordinary);
    if (path.basename(actual) !== filename) return digestPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // A case-colliding key can outlive the ordinary file which caused its alternate path.
    try {
      await realpath(digestPath);
      return digestPath;
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code !== "ENOENT") throw missing;
    }
  }
  return ordinary;
}
