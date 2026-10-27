import { z } from "zod";
import { rename } from "node:fs/promises";
import { INTAKE_API_VERSION } from "./intake-api-version.js";
import { yamlResourcePath, yamlDigest } from "./resource.js";
import {
  readYamlDocumentFile,
  writeYamlDocumentFile,
} from "./internal/yaml-document.js";
const text = z.string().min(1);
export const portalContactSchema = z
  .object({
    firstName: text,
    lastName: text,
    email: z.email(),
    phone: text,
    organization: text,
    street: text,
    city: text,
    state: text,
    zip: text,
  })
  .strict();
export type PortalContact = z.infer<typeof portalContactSchema>;
export const payloadSchema = z
  .object({
    from: text,
    to: z.union([z.email(), z.url()]),
    reply_to: z.email(),
    subject: text,
    portalContact: portalContactSchema.optional(),
    text: text,
    attachments: z.array(z.object({ filename: text, content: text }).strict()),
  })
  .strict();
const responseSchema = z
  .object({
    id: text,
    receivedAt: text,
    evidence: text,
    sha256: text,
    attachments: z.array(z.object({ path: text, sha256: text }).strict()),
    disposition: z.enum([
      "acknowledgment",
      "partial",
      "final",
      "denied",
      "no_records",
      "unclear",
    ]),
    quote: z.string(),
    recordAttachmentIds: z.array(text),
    productionComplete: z.boolean(),
    agencyReference: z.string().optional(),
  })
  .strict();
const schema = z
  .object({
    apiVersion: z.literal(INTAKE_API_VERSION),
    kind: z.literal("RecordsRequest"),
    metadata: z
      .object({
        name: z.string().regex(/^[a-z][a-z0-9]{23}$/),
        namespace: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
      })
      .strict(),
    spec: z
      .object({
        agency: text,
        state: text,
        scope: text,
        createdAt: text,
        submittedAt: text.optional(),
        attemptedAt: z.iso.datetime().optional(),
        submission: z.enum(["reserved", "submitted", "uncertain", "failed"]),
        transport: z.enum(["email", "portal"]),
        forced: z.boolean(),
        providerId: text.optional(),
        references: z.array(text),
        trackingUrl: z.url().optional(),
        evidence: z.array(text),
        notes: z.string(),
        payload: payloadSchema.optional(),
        attachmentSha256: text.optional(),
        error: text.optional(),
        fulfillment: z.enum(["pending", "fulfilled"]),
        disposition: z.enum(["pending", "records", "denied", "no_records"]),
        responses: z.array(responseSchema),
      })
      .strict(),
  })
  .strict();
export type RecordsRequestEnvelope = z.infer<typeof schema>;
export type RequestPayload = z.infer<typeof payloadSchema>;
export const RecordsRequest = {
  kind: "RecordsRequest",
  schema,
  new(input: Omit<RecordsRequestEnvelope, "apiVersion" | "kind">) {
    return schema.parse({
      apiVersion: INTAKE_API_VERSION,
      kind: "RecordsRequest",
      ...input,
    });
  },
  async read(file: string) {
    return schema.parse(
      (await readYamlDocumentFile(file, "RecordsRequest")).document,
    );
  },
  async write(directory: string, input: RecordsRequestEnvelope) {
    const parsed = schema.parse(input);
    const target = yamlResourcePath(directory, parsed);
    const temporary = `${target}.${process.pid}.tmp`;
    const contents = await writeYamlDocumentFile(temporary, parsed);
    await rename(temporary, target);
    return { path: target, sha256: yamlDigest(contents) };
  },
};
