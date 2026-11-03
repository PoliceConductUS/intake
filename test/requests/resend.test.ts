import { expect, test } from "vitest";
import { Resend } from "../../src/cli/requests/resend.js";
import {
  validateAnalysis,
  correlate,
} from "../../src/cli/requests/responses.js";
const payload = {
  from: "a@example.org",
  to: "b@example.org",
  reply_to: "c@example.org",
  subject: "Request abc",
  text: "Complete text",
  attachments: [{ filename: "request.md", content: "eA==" }],
};
test("Resend sends exact payload with durable idempotency identity and fails visibly", async () => {
  let body: unknown;
  let headers: HeadersInit | undefined;
  const resend = new Resend("secret", async (_url, init) => {
    body = JSON.parse(String(init?.body));
    headers = init?.headers;
    return Response.json({ id: "provider" });
  });
  expect(await resend.send("identity", payload)).toEqual({ id: "provider" });
  expect(body).toEqual(payload);
  expect(new Headers(headers).get("Idempotency-Key")).toBe("identity");
  await expect(
    new Resend("key", async () =>
      Response.json({ message: "rejected" }, { status: 422 }),
    ).send("id", payload),
  ).rejects.toThrow(/422/);
});
test("inbound pagination retrieves every message, raw MIME and attachment bytes", async () => {
  const urls: string[] = [];
  const api = new Resend("secret", async (url) => {
    const u = String(url);
    urls.push(u);
    if (u.endsWith("/receiving?limit=100"))
      return Response.json({ data: [{ id: "one" }], has_more: true });
    if (u.includes("after=one"))
      return Response.json({ data: [{ id: "two" }], has_more: false });
    if (u.endsWith("/one"))
      return Response.json({
        id: "one",
        created_at: "2026-01-01T00:00:00Z",
        to: ["box@example.org"],
        subject: "Reply",
        text: "Done",
        html: null,
        headers: {},
        attachments: [
          {
            id: "attachment",
            filename: "records.csv",
            content_type: "text/csv",
          },
        ],
        raw: { download_url: "https://files.example/raw" },
      });
    if (u.endsWith("/attachments/attachment"))
      return Response.json({ download_url: "https://files.example/file" });
    return new Response("bytes");
  });
  expect(await api.list()).toEqual(["one", "two"]);
  const message = await api.receive("one");
  expect(message.raw.toString()).toBe("bytes");
  expect(message.files[0].bytes.toString()).toBe("bytes");
  expect(urls).toContain(
    "https://api.resend.com/emails/receiving/one/attachments/attachment",
  );
});
test.each([
  "acknowledgment",
  "partial",
  "final",
  "denied",
  "no_records",
  "unclear",
] as const)("analysis validates cited evidence for %s", (disposition) => {
  expect(
    validateAnalysis(
      {
        disposition,
        quote: "exact quote",
        recordAttachmentIds: [],
        productionComplete: false,
        agencyReference: null,
        referenceQuote: null,
      },
      "Here is exact quote.",
    ).disposition,
  ).toBe(disposition);
  expect(() =>
    validateAnalysis(
      {
        disposition,
        quote: "invented",
        recordAttachmentIds: [],
        productionComplete: false,
        agencyReference: null,
        referenceQuote: null,
      },
      "Here is exact quote.",
    ),
  ).toThrow(/quote/);
});
test("ambiguous correlation never guesses", () => {
  const rows = [
    { id: "abcdefghijklmnopqrstuvwx", references: ["26-3320"] },
    { id: "bcdefghijklmnopqrstuvwxy", references: ["26-3320"] },
  ];
  expect(correlate("26-3320", rows)).toBeUndefined();
  expect(correlate("Ref abcdefghijklmnopqrstuvwx", rows)).toBe(
    "abcdefghijklmnopqrstuvwx",
  );
  expect(correlate("no reference", rows)).toBeUndefined();
});
test("explicit rejection is distinguishable from uncertain server error", async () => {
  const { SubmissionRejectedError } =
    await import("../../src/cli/requests/lifecycle.js");
  await expect(
    new Resend("key", async () =>
      Response.json({ message: "Rejected" }, { status: 422 }),
    ).send("id", payload),
  ).rejects.toBeInstanceOf(SubmissionRejectedError);
  await expect(
    new Resend("key", async () =>
      Response.json({ message: "Unknown" }, { status: 500 }),
    ).send("id", payload),
  ).rejects.not.toBeInstanceOf(SubmissionRejectedError);
});
