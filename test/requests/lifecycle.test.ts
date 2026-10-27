import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { RecordsRequest } from "../../src/shared/io/RecordsRequest.js";
import {
  RequestStore,
  submit,
  eligibility,
  type RequestDefinition,
} from "../../src/cli/requests/lifecycle.js";
import { describeSources } from "../../src/cli/describe-sources.js";
import { matchSourceIds } from "../../src/cli/source-glob.js";
const dirs: string[] = [];
async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "requests-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const source: RequestDefinition = {
  agency: "Board",
  state: "AA",
  scope: "All records",
  channel: {
    type: "email",
    to: "board@example.org",
    sourceUrl: "https://example.org",
  },
  historical: [
    {
      id: "abcdefghijklmnopqrstuvwx",
      submittedDate: "2026-01-01",
      transport: "portal",
      evidence: "receipt.txt",
      notes: "Confirmed",
    },
  ],
};
const options = {
  sourceId: "gov.test",
  definition: source,
  now: new Date("2026-04-02T00:00:00Z"),
  force: false,
  from: "sender@example.org",
  receivingAddress: "inbox@example.org",
  requester: "Requester",
  standard: Buffer.from("Complete standard request"),
  send: async () => ({ id: "provider-1" }),
};
test("historical imports retain identity and canonical IO rejects extra fields", async () => {
  const store = new RequestStore(await temp());
  await store.importHistory("gov.test", source);
  await store.importHistory("gov.test", source);
  const rows = await store.list("gov.test");
  expect(rows).toHaveLength(1);
  expect(rows[0].spec.transport).toBe("portal");
  expect(rows[0].metadata.name).toBe("abcdefghijklmnopqrstuvwx");
  expect(() =>
    RecordsRequest.schema.parse({ ...rows[0], extra: true }),
  ).toThrow();
  expect(() =>
    RecordsRequest.schema.parse({ ...rows[0], apiVersion: "old" }),
  ).toThrow();
  expect(() =>
    RecordsRequest.schema.parse({
      ...rows[0],
      spec: { ...rows[0].spec, extra: true },
    }),
  ).toThrow();
});
test("date-only eligibility uses end of day and force overrides interval", () => {
  expect(
    eligibility("2026-01-01", new Date("2026-04-01T23:59:59.998Z"), false)
      .eligible,
  ).toBe(false);
  expect(
    eligibility("2026-01-01", new Date("2026-04-01T23:59:59.999Z"), false)
      .eligible,
  ).toBe(true);
  expect(eligibility("2026-01-01", new Date("2026-01-02"), true).eligible).toBe(
    true,
  );
});
test("reservation blocks concurrent submission and preserves exact payload", async () => {
  const store = new RequestStore(await temp());
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const first = submit(store, {
    ...options,
    send: async () => {
      entered();
      await wait;
      return { id: "provider-1" };
    },
  });
  await started;
  await expect(submit(store, options)).rejects.toThrow(/locked/);
  release();
  const row = await first;
  expect(row.spec.submission).toBe("submitted");
  expect(row.spec.payload?.text).toContain(row.metadata.name);
  expect(row.spec.payload?.attachments[0].content).toBe(
    Buffer.from("Complete standard request").toString("base64"),
  );
  expect(await store.list("gov.test")).toHaveLength(2);
});
test("uncertain transport is durable and force cannot send another copy", async () => {
  const store = new RequestStore(await temp());
  await expect(
    submit(store, {
      ...options,
      send: async () => {
        throw new Error("timeout");
      },
    }),
  ).rejects.toThrow("timeout");
  const rows = await store.list("gov.test");
  expect(
    rows.find((row) => row.spec.submission === "uncertain")?.spec.error,
  ).toContain("timeout");
  await expect(submit(store, { ...options, force: true })).rejects.toThrow(
    /reconcil/,
  );
});
test("request-only sources appear in catalog but never default transform selection", async () => {
  const dir = await temp();
  await mkdir(path.join(dir, "request"));
  await writeFile(
    path.join(dir, "request/request.ts"),
    'export const description="Request";',
  );
  await mkdir(path.join(dir, "data"));
  await writeFile(
    path.join(dir, "data/transform.ts"),
    "export const produces=[];",
  );
  expect(
    (await describeSources(dir)).map((row) => [row.id, row.phases]),
  ).toEqual([
    ["data", ["transform"]],
    ["request", ["request"]],
  ]);
  expect(await matchSourceIds(dir, "*")).toEqual(["data"]);
});
test("sync keeps acknowledgment pending, saves final records and repeat sync is no-op", async () => {
  const { syncMessages } = await import("../../src/cli/requests/responses.js");
  const store = new RequestStore(await temp());
  await store.importHistory("gov.test", source);
  const make = (
    id: string,
    text: string,
    files: { id: string; bytes: Buffer }[] = [],
  ) => ({
    message: {
      id,
      created_at: "2026-02-01T00:00:00Z",
      to: ["inbox@example.org"],
      subject: source.historical[0].id,
      text,
      html: null,
      headers: {},
      attachments: files.map((file) => ({
        id: file.id,
        filename: file.id,
        content_type: "text/plain",
      })),
      raw: { download_url: "https://example.org/raw" },
    },
    json: '{"raw":"evidence"}',
    raw: Buffer.from(text),
    files,
  });
  const ack = make("ack", "Acknowledged reference R-123");
  await syncMessages(
    store,
    ["gov.test"],
    { list: async () => ["ack"], receive: async () => ack },
    "inbox@example.org",
    async () => ({
      disposition: "acknowledgment",
      quote: "Acknowledged",
      recordAttachmentIds: [],
      productionComplete: false,
      agencyReference: "R-123",
      referenceQuote: "reference R-123",
    }),
  );
  let row = (await store.list("gov.test"))[0];
  expect(row.spec.fulfillment).toBe("pending");
  expect(row.spec.references).toEqual(["R-123"]);
  const final = make("final", "All requested records attached", [
    { id: "file", bytes: Buffer.from("record data") },
  ]);
  const inbox = {
    list: async () => ["ack", "final"],
    receive: async () => final,
  };
  await syncMessages(
    store,
    ["gov.test"],
    inbox,
    "inbox@example.org",
    async () => ({
      disposition: "final",
      quote: "All requested records attached",
      recordAttachmentIds: ["file"],
      productionComplete: true,
      agencyReference: null,
      referenceQuote: null,
    }),
  );
  row = (await store.list("gov.test"))[0];
  expect(row.spec.fulfillment).toBe("fulfilled");
  expect(
    await readFile(row.spec.responses[1].attachments[0].path, "utf8"),
  ).toBe("record data");
  expect(
    (
      await syncMessages(
        store,
        ["gov.test"],
        inbox,
        "inbox@example.org",
        async () => {
          throw new Error("must not analyze twice");
        },
      )
    ).map((result) => result.status),
  ).toEqual(["already-saved", "already-saved"]);
  expect((await store.list("gov.test"))[0].spec.responses).toHaveLength(2);
});
test("older denial arriving after a final production cannot overwrite the newer disposition", async () => {
  const { syncMessages } = await import("../../src/cli/requests/responses.js");
  const store = new RequestStore(await temp());
  await store.importHistory("gov.test", source);
  const row = (await store.list("gov.test"))[0];
  row.spec.fulfillment = "fulfilled";
  row.spec.disposition = "records";
  row.spec.responses = [
    {
      id: "newer",
      receivedAt: "2026-03-01T00:00:00Z",
      evidence: "saved",
      sha256: "hash",
      attachments: [{ path: "saved/file", sha256: "hash" }],
      disposition: "final",
      quote: "All records",
      recordAttachmentIds: ["file"],
      productionComplete: true,
    },
  ];
  await store.save(row);
  await syncMessages(
    store,
    ["gov.test"],
    {
      list: async () => ["older"],
      receive: async () => ({
        message: {
          id: "older",
          created_at: "2026-02-01T00:00:00Z",
          to: ["inbox@example.org"],
          subject: row.metadata.name,
          text: "Denied",
          html: null,
          headers: {},
          attachments: [],
          raw: { download_url: "https://example.org/raw" },
        },
        json: "{}",
        raw: Buffer.from("Denied"),
        files: [],
      }),
    },
    "inbox@example.org",
    async () => ({
      disposition: "denied",
      quote: "Denied",
      recordAttachmentIds: [],
      productionComplete: false,
      agencyReference: null,
      referenceQuote: null,
    }),
  );
  expect((await store.list("gov.test"))[0].spec.disposition).toBe("records");
});
test("final wording and a signature attachment do not prove returned records", async () => {
  const { syncMessages } = await import("../../src/cli/requests/responses.js");
  const store = new RequestStore(await temp());
  await store.importHistory("gov.test", source);
  await syncMessages(
    store,
    ["gov.test"],
    {
      list: async () => ["signature"],
      receive: async () => ({
        message: {
          id: "signature",
          created_at: "2026-02-01T00:00:00Z",
          to: ["inbox@example.org"],
          subject: source.historical[0].id,
          text: "Complete; records are at this link.",
          html: null,
          headers: {},
          attachments: [
            { id: "logo", filename: "logo.png", content_type: "image/png" },
          ],
          raw: { download_url: "https://example.org/raw" },
        },
        json: "{}",
        raw: Buffer.from("email"),
        files: [{ id: "logo", bytes: Buffer.from("image") }],
      }),
    },
    "inbox@example.org",
    async () => ({
      disposition: "final",
      quote: "Complete",
      recordAttachmentIds: [],
      productionComplete: false,
      agencyReference: null,
      referenceQuote: null,
    }),
  );
  expect((await store.list("gov.test"))[0].spec.fulfillment).toBe("pending");
});
test("definitive rejection can retry the exact payload with the same request identity", async () => {
  const { SubmissionRejectedError } =
    await import("../../src/cli/requests/lifecycle.js");
  const store = new RequestStore(await temp());
  await expect(
    submit(store, {
      ...options,
      send: async () => {
        throw new SubmissionRejectedError("Rejected");
      },
    }),
  ).rejects.toThrow();
  const failed = (await store.list("gov.test")).find(
    (row) => row.spec.submission === "failed",
  )!;
  expect(failed).toBeDefined();
  const retried = await submit(store, {
    ...options,
    requester: "Changed text must not replace persisted payload",
  });
  expect(retried.metadata.name).toBe(failed.metadata.name);
  expect(retried.spec.payload).toEqual(failed.spec.payload);
  expect(await store.list("gov.test")).toHaveLength(2);
});
test("correlated acknowledgment reconciles uncertain submission and explicit association resolves missing identifiers", async () => {
  const { syncMessages } = await import("../../src/cli/requests/responses.js");
  const store = new RequestStore(await temp());
  const { SubmissionRejectedError } =
    await import("../../src/cli/requests/lifecycle.js");
  await expect(
    submit(store, {
      ...options,
      send: async () => {
        throw new SubmissionRejectedError("Rejected first attempt");
      },
    }),
  ).rejects.toThrow("Rejected first attempt");
  await expect(
    submit(store, {
      ...options,
      now: new Date("2026-05-02T00:00:00Z"),
      send: async () => {
        throw new Error("timeout");
      },
    }),
  ).rejects.toThrow();
  const row = (await store.list("gov.test")).find(
    (row) => row.spec.submission === "uncertain",
  )!;
  await syncMessages(
    store,
    ["gov.test"],
    {
      list: async () => ["ack"],
      receive: async () => ({
        message: {
          id: "ack",
          created_at: "2026-05-03T00:00:00Z",
          to: ["inbox@example.org"],
          subject: "Your request",
          text: "Received your request",
          html: null,
          headers: {},
          attachments: [],
          raw: { download_url: "https://example.org/raw" },
        },
        json: "{}",
        raw: Buffer.from("Received"),
        files: [],
      }),
    },
    "inbox@example.org",
    async () => ({
      disposition: "acknowledgment",
      quote: "Received your request",
      recordAttachmentIds: [],
      productionComplete: false,
      agencyReference: null,
      referenceQuote: null,
    }),
    { ack: row.metadata.name },
  );
  const updated = (await store.list("gov.test")).find(
    (entry) => entry.metadata.name === row.metadata.name,
  )!;
  expect(updated.spec.submission).toBe("submitted");
  expect(updated.spec.createdAt).toBe("2026-04-02T00:00:00.000Z");
  expect(updated.spec.submittedAt).toBe("2026-05-02T00:00:00.000Z");
  expect(
    eligibility(updated.spec.submittedAt, new Date("2026-07-01"), false)
      .eligible,
  ).toBe(false);
});
test("a final completion notice can fulfill records already saved from partial production", async () => {
  const { syncMessages } = await import("../../src/cli/requests/responses.js");
  const store = new RequestStore(await temp());
  await store.importHistory("gov.test", source);
  const row = (await store.list("gov.test"))[0];
  row.spec.responses = [
    {
      id: "partial",
      receivedAt: "2026-02-01T00:00:00Z",
      evidence: "saved",
      sha256: "hash",
      attachments: [{ path: "saved/file", sha256: "hash" }],
      recordAttachmentIds: ["file"],
      productionComplete: false,
      disposition: "partial",
      quote: "First records",
    },
  ];
  await store.save(row);
  await syncMessages(
    store,
    ["gov.test"],
    {
      list: async () => ["final"],
      receive: async () => ({
        message: {
          id: "final",
          created_at: "2026-03-01T00:00:00Z",
          to: ["inbox@example.org"],
          subject: row.metadata.name,
          text: "The previously supplied records are the complete production.",
          html: null,
          headers: {},
          attachments: [],
          raw: { download_url: "https://example.org/raw" },
        },
        json: "{}",
        raw: Buffer.from("Complete"),
        files: [],
      }),
    },
    "inbox@example.org",
    async () => ({
      disposition: "final",
      quote: "The previously supplied records are the complete production.",
      recordAttachmentIds: [],
      productionComplete: true,
      agencyReference: null,
      referenceQuote: null,
    }),
  );
  expect((await store.list("gov.test"))[0].spec.fulfillment).toBe("fulfilled");
});
test("changed historical source fields fail visibly instead of being existence-skipped", async () => {
  const store = new RequestStore(await temp());
  await store.importHistory("gov.test", source);
  await expect(
    store.importHistory("gov.test", {
      ...source,
      scope: "changed source scope",
    }),
  ).rejects.toThrow(/Historical request changed/);
});
test("submission records the attempt timestamp before transport and uses the configured reply contact", async () => {
  const store = new RequestStore(await temp());
  const row = await submit(store, {
    ...options,
    send: async (id) => {
      const reserved = (await store.list("gov.test")).find(
        (row) => row.metadata.name === id,
      )!;
      expect(reserved.spec.attemptedAt).toBe("2026-04-02T00:00:00.000Z");
      return { id: "receipt" };
    },
  });
  expect(row.spec.payload?.text).toContain("Reply contact: inbox@example.org");
  expect(row.spec.payload?.reply_to).toBe("inbox@example.org");
});

test.each([false, true])(
  "final linked records remain pending even with prior or current saved attachments: %s",
  async (hasCurrentAttachment) => {
    const { syncMessages } =
      await import("../../src/cli/requests/responses.js");
    const store = new RequestStore(await temp());
    await store.importHistory("gov.test", source);
    const row = (await store.list("gov.test"))[0];
    row.spec.responses = [
      {
        id: "partial",
        receivedAt: "2026-02-01T00:00:00Z",
        evidence: "saved",
        sha256: "hash",
        attachments: [{ path: "saved/file", sha256: "hash" }],
        recordAttachmentIds: ["file"],
        productionComplete: false,
        disposition: "partial",
        quote: "First records",
      },
    ];
    await store.save(row);
    await syncMessages(
      store,
      ["gov.test"],
      {
        list: async () => ["final"],
        receive: async () => ({
          message: {
            id: "final",
            created_at: "2026-03-01T00:00:00Z",
            to: ["inbox@example.org"],
            subject: row.metadata.name,
            text: "Final response: additional records are available at this external link.",
            html: null,
            headers: {},
            attachments: hasCurrentAttachment
              ? [
                  {
                    id: "extra",
                    filename: "extra.csv",
                    content_type: "text/csv",
                  },
                ]
              : [],
            raw: { download_url: "https://example.org/raw" },
          },
          json: "{}",
          raw: Buffer.from("Complete"),
          files: hasCurrentAttachment
            ? [{ id: "extra", bytes: Buffer.from("some but not all records") }]
            : [],
        }),
      },
      "inbox@example.org",
      async () => ({
        disposition: "final",
        quote:
          "Final response: additional records are available at this external link.",
        recordAttachmentIds: hasCurrentAttachment ? ["extra"] : [],
        productionComplete: false,
        agencyReference: null,
        referenceQuote: null,
      }),
    );
    expect((await store.list("gov.test"))[0].spec.fulfillment).toBe("pending");
  },
);
test("first sync processes a newest-first backlog in chronological order so final analysis sees prior saved records", async () => {
  const { syncMessages } = await import("../../src/cli/requests/responses.js");
  const store = new RequestStore(await temp());
  await store.importHistory("gov.test", source);
  const messages = {
    partial: {
      id: "partial",
      createdAt: "2026-02-01T00:00:00Z",
      text: "First batch of records",
      files: [{ id: "file", bytes: Buffer.from("records") }],
    },
    final: {
      id: "final",
      createdAt: "2026-03-01T00:00:00Z",
      text: "All previously supplied records are the complete production.",
      files: [],
    },
  };
  const report = await syncMessages(
    store,
    ["gov.test"],
    {
      list: async () => ["final", "partial"],
      receive: async (id) => {
        const item = messages[id as keyof typeof messages];
        return {
          message: {
            id,
            created_at: item.createdAt,
            to: ["inbox@example.org"],
            subject: source.historical[0].id,
            text: item.text,
            html: null,
            headers: {},
            attachments: item.files.map((file) => ({
              id: file.id,
              filename: "records.csv",
              content_type: "text/csv",
            })),
            raw: { download_url: "https://example.org/raw" },
          },
          json: JSON.stringify(item),
          raw: Buffer.from(item.text),
          files: item.files,
        };
      },
    },
    "inbox@example.org",
    async (text) =>
      text.includes(
        "All previously supplied records are the complete production.",
      )
        ? {
            disposition: "final",
            quote:
              "All previously supplied records are the complete production.",
            recordAttachmentIds: [],
            productionComplete: text.includes("First batch of records"),
            agencyReference: null,
            referenceQuote: null,
          }
        : {
            disposition: "partial",
            quote: "First batch of records",
            recordAttachmentIds: ["file"],
            productionComplete: false,
            agencyReference: null,
            referenceQuote: null,
          },
  );
  expect(report.map((row) => row.id)).toEqual(["partial", "final"]);
  expect((await store.list("gov.test"))[0].spec.fulfillment).toBe("fulfilled");
});
