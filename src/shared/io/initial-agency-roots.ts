import { stat } from "node:fs/promises";
import path from "node:path";
import {
  InitialAgencyRoots,
  type InitialAgencyRootsEnvelope,
} from "./InitialAgencyRoots.js";
import { yamlResourceFileName } from "./resource.js";

export function initialAgencyRootsDirectory(
  root: string,
  namespace: string,
): string {
  return path.join(
    root,
    "intake",
    "state",
    "namespaces",
    encodeURIComponent(namespace),
    InitialAgencyRoots.kind,
  );
}

export async function loadInitialAgencyRoots(
  root: string,
  namespace: string,
): Promise<InitialAgencyRootsEnvelope | undefined> {
  const file = path.join(
    initialAgencyRootsDirectory(root, namespace),
    yamlResourceFileName("initial", InitialAgencyRoots.kind),
  );
  try {
    await stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return InitialAgencyRoots.read(file, { expectedNamespace: namespace });
}
