import type { z } from "zod";
import type { ArtifactsEnvelope } from "../../../shared/io/Artifacts.js";
import { importTypeRegistry } from "../../../shared/io/import-types.js";

function firstIssuePath(error: z.ZodError): string {
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

// Fail loud on any artifact record that does not match its import record schema
// before it reaches a facade.
export function validateArtifactRecords(artifacts: ArtifactsEnvelope): void {
  for (const artifact of artifacts.spec.artifacts) {
    const definition = importTypeRegistry[artifact.kind];
    for (const [recordKey, record] of Object.entries(artifact.spec.records)) {
      const result = definition.recordSchema.safeParse(record);
      if (!result.success) {
        throw new Error(
          `Artifacts ${artifact.kind} record ${recordKey} is malformed at ${firstIssuePath(result.error)}.`,
        );
      }
    }
  }
}
