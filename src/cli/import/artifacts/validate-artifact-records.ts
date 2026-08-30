import { z } from "zod";
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
      // A record is an envelope (ADR 0034): validate its spec (the payload), not
      // the envelope. A PATCH sets only some fields, so it validates against a
      // partial of the record schema; PUT/POST validate the full spec.
      const envelope = record as {
        spec?: unknown;
        metadata?: { action?: "PUT" | "PATCH" | "POST" };
      };
      const spec = envelope.spec ?? record;
      const schema =
        envelope.metadata?.action === "PATCH" &&
        definition.recordSchema instanceof z.ZodObject
          ? definition.recordSchema.partial()
          : definition.recordSchema;
      const result = schema.safeParse(spec);
      if (!result.success) {
        throw new Error(
          `Artifacts ${artifact.kind} record ${recordKey} is malformed at ${firstIssuePath(result.error)}.`,
        );
      }
    }
  }
}
