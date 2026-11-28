import { z } from "zod";
import { INTAKE_API_VERSION } from "./intake-api-version.js";
import { readYamlDocumentFile } from "./internal/yaml-document.js";
const text = z.string().min(1);
const schema = z.strictObject({
  apiVersion: z.literal(INTAKE_API_VERSION),
  kind: z.literal("ResolvedProperty"),
  metadata: z.strictObject({ namespace: z.literal("intake"), name: text }),
  spec: z.strictObject({
    subject: z.strictObject({
      apiVersion: z.literal(INTAKE_API_VERSION),
      namespace: text,
      kind: text,
      name: text,
    }),
    targetProperty: text,
    inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    value: z.json(),
  }),
});
// Read-only historical representation for the workspace migration's private archive.
export const SourceScopedResolvedProperty = {
  async read(file: string) {
    const { contents, document } = await readYamlDocumentFile(
      file,
      "Source-scoped ResolvedProperty",
    );
    const envelope = schema.parse(document),
      { subject, targetProperty, inputFingerprint } = envelope.spec;
    if (
      envelope.metadata.name !==
      [
        subject.apiVersion,
        subject.namespace,
        subject.kind,
        subject.name,
        targetProperty,
        inputFingerprint,
      ].join(":")
    )
      throw Error("Wrong source-scoped cache identity: " + file);
    return { contents, envelope };
  },
};
