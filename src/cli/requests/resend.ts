import { z } from "zod";
import { SubmissionRejectedError } from "./lifecycle.js";
import type { RequestPayload } from "../../shared/io/RecordsRequest.js";
const id = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const receivedSchema = z.object({
  id,
  created_at: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  text: z.string().nullable(),
  html: z.string().nullable(),
  headers: z.record(z.string(), z.string()),
  attachments: z.array(
    z.object({ id, filename: z.string().nullable(), content_type: z.string() }),
  ),
  raw: z.object({ download_url: z.url() }).nullable(),
});
export type ReceivedMessage = {
  message: z.infer<typeof receivedSchema>;
  json: string;
  raw: Buffer;
  files: { id: string; bytes: Buffer }[];
};
export class Resend {
  constructor(
    private readonly key: string,
    private readonly http: typeof fetch = fetch,
  ) {
    if (!key.trim()) throw new Error("Resend API key required");
  }
  private async request(route: string, init: RequestInit = {}) {
    const response = await this.http(`https://api.resend.com${route}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(60000),
    });
    const text = await response.text();
    if (!response.ok) {
      const ErrorType =
        init.method === "POST" &&
        [400, 401, 403, 404, 422, 429].includes(response.status)
          ? SubmissionRejectedError
          : Error;
      throw new ErrorType(`Resend ${response.status}: ${text}`);
    }
    return JSON.parse(text) as unknown;
  }
  async send(requestId: string, payload: RequestPayload) {
    return z.object({ id: z.string().min(1) }).parse(
      await this.request("/emails", {
        method: "POST",
        headers: { "Idempotency-Key": requestId },
        body: JSON.stringify(payload),
      }),
    );
  }
  async list() {
    const ids: string[] = [];
    let after: string | undefined;
    do {
      const page = z
        .object({ data: z.array(z.object({ id })), has_more: z.boolean() })
        .parse(
          await this.request(
            `/emails/receiving?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`,
          ),
        );
      for (const item of page.data) {
        if (ids.includes(item.id))
          throw new Error("Resend pagination repeated a message");
        ids.push(item.id);
      }
      if (page.has_more && page.data.length === 0)
        throw new Error("Resend pagination returned empty continuation");
      after = page.has_more ? page.data.at(-1)!.id : undefined;
    } while (after);
    return ids;
  }
  private async download(url: string) {
    const response = await this.http(url, {
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(`Resend evidence download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  async receive(messageId: string): Promise<ReceivedMessage> {
    id.parse(messageId);
    const value = await this.request(`/emails/receiving/${messageId}`);
    const message = receivedSchema.parse(value);
    if (message.id !== messageId) throw new Error("Resend message ID mismatch");
    if (!message.raw) throw new Error(`Raw email unavailable: ${messageId}`);
    const raw = await this.download(message.raw.download_url);
    const files = [];
    for (const attachment of message.attachments) {
      const detail = z
        .object({ download_url: z.url() })
        .parse(
          await this.request(
            `/emails/receiving/${messageId}/attachments/${attachment.id}`,
          ),
        );
      files.push({
        id: attachment.id,
        bytes: await this.download(detail.download_url),
      });
    }
    return { message, json: JSON.stringify(value, null, 2), raw, files };
  }
}
