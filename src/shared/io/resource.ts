import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";

export type YamlResource = {
  kind: string;
  metadata: { name: string } & Record<string, unknown>;
} & Record<string, unknown>;

export function yamlResourceFileName(id: string, kind: string): string {
  return `${encodeURIComponent(id)}.${kind}.yaml`;
}

export function yamlResourcePath(
  directory: string,
  resource: YamlResource,
): string {
  return path.join(
    directory,
    yamlResourceFileName(resource.metadata.name, resource.kind),
  );
}

export function yamlDigest(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

export function firstIssuePath(error: z.ZodError): string {
  const issue = error.issues[0];
  if (
    issue?.code === "unrecognized_keys" &&
    "keys" in issue &&
    issue.keys.length > 0
  ) {
    return [...issue.path, issue.keys[0]].join(".");
  }
  return issue?.path.join(".") || "record";
}
