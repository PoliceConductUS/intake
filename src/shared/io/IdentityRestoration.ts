import { z } from "zod";
import { INTAKE_API_VERSION } from "./intake-api-version.js";
import { TABLE_BY_KIND } from "./generated/entity-specs.js";
import { yamlResourcePath } from "./resource.js";
import {
  readYamlDocumentFile,
  writeYamlDocumentFile,
} from "./internal/yaml-document.js";

const text = z.string().trim().min(1);
const schema = z
  .object({
    apiVersion: z.literal(INTAKE_API_VERSION),
    kind: z.literal("IdentityRestoration"),
    metadata: z
      .object({
        name: text,
        namespace: text,
        annotations: z.record(z.string(), z.string()).optional(),
      })
      .strict(),
    spec: z
      .object({
        entityKind: text.refine(
          (value) => Object.hasOwn(TABLE_BY_KIND, value),
          "Unsupported entity kind",
        ),
        sourceName: text,
        expectedCurrentId: text,
        originalId: text,
        reason: text,
        evidence: text,
      })
      .strict()
      .refine(
        (value) => value.expectedCurrentId !== value.originalId,
        "Restoration IDs must differ",
      ),
  })
  .strict();
export type IdentityRestorationEnvelope = z.infer<typeof schema>;
export const IdentityRestoration = {
  kind: "IdentityRestoration",
  schema,
  new(
    input: Omit<IdentityRestorationEnvelope, "apiVersion" | "kind">,
  ): IdentityRestorationEnvelope {
    return schema.parse({
      apiVersion: INTAKE_API_VERSION,
      kind: "IdentityRestoration",
      ...input,
    });
  },
  async read(filePath: string): Promise<IdentityRestorationEnvelope> {
    return schema.parse(
      (await readYamlDocumentFile(filePath, "IdentityRestoration")).document,
    );
  },
  async write(
    directory: string,
    envelope: IdentityRestorationEnvelope,
  ): Promise<{ path: string }> {
    const parsed = schema.parse(envelope);
    const filePath = yamlResourcePath(directory, parsed);
    await writeYamlDocumentFile(filePath, parsed);
    return { path: filePath };
  },
};
