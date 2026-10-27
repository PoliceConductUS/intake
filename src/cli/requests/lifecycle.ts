import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { createHash } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  RecordsRequest,
  portalContactSchema,
  type PortalContact,
  type RecordsRequestEnvelope,
  type RequestPayload,
} from "../../shared/io/RecordsRequest.js";
const text = z.string().min(1);
export const requestDefinitionSchema = z
  .object({
    agency: text,
    state: text,
    scope: text,
    channel: z.discriminatedUnion("type", [
      z
        .object({ type: z.literal("email"), to: z.email(), sourceUrl: z.url() })
        .strict(),
      z
        .object({ type: z.literal("portal"), url: z.url(), sourceUrl: z.url() })
        .strict(),
    ]),
    historical: z.array(
      z
        .object({
          id: z.string().regex(/^[a-z][a-z0-9]{23}$/),
          submittedDate: z.iso.date(),
          transport: z.enum(["email", "portal"]),
          reference: text.optional(),
          trackingUrl: z.url().optional(),
          evidence: text,
          notes: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type RequestDefinition = z.infer<typeof requestDefinitionSchema>;
export const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
export function eligibility(
  submitted: string | undefined,
  now: Date,
  force: boolean,
) {
  const end =
    submitted?.length === 10 ? `${submitted}T23:59:59.999Z` : submitted;
  const next = end
    ? new Date(new Date(end).getTime() + 90 * 86400000).toISOString()
    : undefined;
  return {
    eligible:
      force || next === undefined || now.getTime() >= new Date(next).getTime(),
    next,
  };
}
export class RequestStore {
  constructor(readonly workspace: string) {}
  directory(source: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(source))
      throw new Error("Invalid source namespace");
    return path.join(
      this.workspace,
      "intake/state/namespaces",
      source,
      "RecordsRequest",
    );
  }
  async lock<T>(source: string, work: () => Promise<T>): Promise<T> {
    const directory = this.directory(source);
    await mkdir(directory, { recursive: true });
    const lock = path.join(directory, ".lock");
    try {
      await mkdir(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error(
          `Request source ${source} is locked; inspect interrupted operation before removing lock`,
        );
      throw error;
    }
    try {
      return await work();
    } finally {
      await rm(lock, { recursive: true });
    }
  }
  async list(source: string) {
    const directory = this.directory(source);
    await mkdir(directory, { recursive: true });
    return Promise.all(
      (await readdir(directory))
        .filter((file) => file.endsWith(".yaml"))
        .sort()
        .map(async (file) => {
          const row = await RecordsRequest.read(path.join(directory, file));
          if (row.metadata.namespace !== source)
            throw new Error("Request namespace mismatch");
          return row;
        }),
    );
  }
  async save(row: RecordsRequestEnvelope) {
    return RecordsRequest.write(this.directory(row.metadata.namespace), row);
  }
  async importHistory(source: string, definition: RequestDefinition) {
    return this.lock(source, () => this.importUnlocked(source, definition));
  }
  async importUnlocked(source: string, input: RequestDefinition) {
    const definition = requestDefinitionSchema.parse(input);
    const existing = await this.list(source);
    for (const entry of definition.historical) {
      const old = existing.find((row) => row.metadata.name === entry.id);
      if (old) {
        if (
          old.spec.submittedAt !== entry.submittedDate ||
          old.spec.agency !== definition.agency ||
          old.spec.state !== definition.state ||
          old.spec.scope !== definition.scope ||
          old.spec.transport !== entry.transport ||
          old.spec.trackingUrl !== entry.trackingUrl ||
          !old.spec.evidence.includes(entry.evidence) ||
          (entry.reference && !old.spec.references.includes(entry.reference)) ||
          old.spec.notes !== entry.notes
        )
          throw new Error(`Historical request changed: ${entry.id}`);
        continue;
      }
      await this.save(
        RecordsRequest.new({
          metadata: { name: entry.id, namespace: source },
          spec: {
            agency: definition.agency,
            state: definition.state,
            scope: definition.scope,
            createdAt: entry.submittedDate,
            submittedAt: entry.submittedDate,
            submission: "submitted",
            transport: entry.transport,
            forced: false,
            references: entry.reference ? [entry.reference] : [],
            trackingUrl: entry.trackingUrl,
            evidence: [entry.evidence],
            notes: entry.notes,
            fulfillment: "pending",
            disposition: "pending",
            responses: [],
          },
        }),
      );
    }
  }
}
export type SubmitOptions = {
  sourceId: string;
  definition: RequestDefinition;
  now: Date;
  force: boolean;
  from: string;
  receivingAddress: string;
  requester: string;
  portalContact?: PortalContact;
  standard: Buffer;
  send: (
    id: string,
    payload: RequestPayload,
  ) => Promise<{ id: string; evidence?: string[] }>;
  sendPortal?: (
    id: string,
    payload: RequestPayload,
  ) => Promise<{ id: string; evidence?: string[] }>;
};
export async function submit(store: RequestStore, options: SubmitOptions) {
  return store.lock(options.sourceId, async () => {
    const definition = requestDefinitionSchema.parse(options.definition);
    await store.importUnlocked(options.sourceId, definition);
    const rows = await store.list(options.sourceId);
    assertCanSubmit(rows, options.now, options.force);
    const failed = rows.find((row) => row.spec.submission === "failed");
    if (failed) return sendReserved(store, failed, options);
    if (definition.channel.type === "portal" && !options.sendPortal)
      throw new Error(
        `Portal has no verified submission adapter: ${definition.channel.url}`,
      );
    const portalContact =
      definition.channel.type === "portal"
        ? portalContactSchema.parse(options.portalContact)
        : undefined;
    if (portalContact && portalContact.email !== options.receivingAddress)
      throw new Error("Portal contact email must match the receiving address");
    const id = createId();
    const payload: RequestPayload = {
      from: options.from,
      ...(portalContact ? { portalContact } : {}),
      to:
        definition.channel.type === "email"
          ? definition.channel.to
          : definition.channel.url,
      reply_to: options.receivingAddress,
      subject: `Public records request [${id}] — ${definition.agency}`,
      text: `${definition.agency}\n\n${definition.scope}\n\nPlease provide the records described in the attached complete standard request.\n\n${options.requester}\nReply contact: ${options.receivingAddress}\nRequest ID: ${id}`,
      attachments: [
        {
          filename: "data-request-format.md",
          content: options.standard.toString("base64"),
        },
      ],
    };
    const row = RecordsRequest.new({
      metadata: { name: id, namespace: options.sourceId },
      spec: {
        agency: definition.agency,
        state: definition.state,
        scope: definition.scope,
        createdAt: options.now.toISOString(),
        submission: "reserved",
        transport: definition.channel.type,
        forced: options.force,
        references: [],
        evidence: [],
        notes: "",
        payload,
        attachmentSha256: digest(options.standard),
        fulfillment: "pending",
        disposition: "pending",
        responses: [],
      },
    });
    await store.save(row);
    return sendReserved(store, row, options);
  });
}

export class SubmissionRejectedError extends Error {}
export function assertCanSubmit(
  rows: RecordsRequestEnvelope[],
  now: Date,
  force: boolean,
) {
  if (
    rows.some(
      (row) =>
        row.spec.submission === "reserved" ||
        row.spec.submission === "uncertain",
    )
  )
    throw new Error(
      "Unresolved request requires reconciliation before another submission",
    );
  const last = rows
    .filter((row) => row.spec.submittedAt)
    .sort((a, b) => b.spec.submittedAt!.localeCompare(a.spec.submittedAt!))[0];
  const eligible = eligibility(last?.spec.submittedAt, now, force);
  if (!eligible.eligible)
    throw new Error(
      `Request ${last.metadata.name} next eligible ${eligible.next}`,
    );
}
async function sendReserved(
  store: RequestStore,
  row: RecordsRequestEnvelope,
  options: SubmitOptions,
) {
  if (!row.spec.payload) throw new Error("Request has no saved payload");
  row.spec.submission = "reserved";
  row.spec.attemptedAt = options.now.toISOString();
  delete row.spec.error;
  await store.save(row);
  try {
    const send =
      row.spec.transport === "portal" ? options.sendPortal : options.send;
    if (!send) throw new Error("Portal has no verified submission adapter");
    const receipt = await send(row.metadata.name, row.spec.payload);
    row.spec.providerId = receipt.id;
    row.spec.evidence.push(...(receipt.evidence ?? []));
    row.spec.submission = "submitted";
    row.spec.submittedAt = options.now.toISOString();
    await store.save(row);
    return row;
  } catch (error) {
    row.spec.submission =
      error instanceof SubmissionRejectedError ? "failed" : "uncertain";
    row.spec.error = error instanceof Error ? error.message : String(error);
    await store.save(row);
    throw error;
  }
}
