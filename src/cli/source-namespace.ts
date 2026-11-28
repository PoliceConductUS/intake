import { assertValidSourceId } from "../shared/source-namespace.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function sourceNamespace(
  sourcesRoot: string,
  sourceDirectory: string,
): string {
  const relative = path.relative(sourcesRoot, sourceDirectory);
  const segments = relative.split(path.sep);
  if (!relative || path.isAbsolute(relative) || segments.includes("..")) {
    throw new Error(
      `Invalid source directory outside the sources root: ${sourceDirectory}`,
    );
  }
  const namespace = segments.join("/");
  assertValidSourceId(namespace);
  return namespace;
}

export function moduleSourceNamespace(moduleUrl: string): string {
  return sourceNamespace(
    fileURLToPath(new URL("../../sources/", import.meta.url)),
    path.dirname(fileURLToPath(moduleUrl)),
  );
}
