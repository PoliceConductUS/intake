import { describe, expect, test } from "vitest";
import {
  createDownloadClient,
  downloadRequest,
} from "../../../src/shared/services/download-client.js";
import { ServiceUnavailableError } from "../../../src/shared/services/client-base.js";
import { fakeFetch, harness, START, type FakeAnswer } from "./harness.js";

// sha256("hello") and sha256("world"), from the shell's shasum.
const HELLO =
  "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const WORLD =
  "486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7";
const URL_A = "https://files.example.org/orders/a.pdf";
const pdf = (body: string): FakeAnswer => ({
  status: 200,
  body,
  headers: { "content-type": "application/pdf; charset=binary" },
});

function site(files: (url: string) => FakeAnswer) {
  return fakeFetch((url) =>
    new URL(url).pathname === "/" ? { status: 403 } : files(url),
  );
}

describe("DownloadClient", () => {
  test("stores a downloaded PDF as a binary file named by the call result", async () => {
    const h = await harness();
    const web = site(() => pdf("hello"));
    const client = createDownloadClient({ ...h.deps, fetch: web.fetch });

    const result = await client.download(URL_A);

    if (result.status !== "succeeded") throw new Error(result.status);
    expect(result.file.bytes.toString()).toBe("hello");
    expect(result.file.envelope.spec).toEqual({
      sha256: HELLO,
      bytes: 5,
      contentType: "application/pdf",
      extension: "pdf",
      origin: {
        kind: "download",
        url: URL_A,
        retrievedAt: START,
        httpStatus: 200,
      },
    });
    expect(await h.binaryFileNames()).toEqual([
      `${HELLO}.BinaryFile.yaml`,
      `${HELLO}.pdf`,
    ]);
    expect(await h.outcomes(downloadRequest(URL_A))).toMatchObject([
      { status: "succeeded", file: HELLO, completedAt: START, httpStatus: 200 },
    ]);
    expect(downloadRequest(URL_A)).toEqual({
      service: "download",
      operation: "get",
      url: URL_A,
    });
  });

  test("checks the host once, then serves a repeat from the cache", async () => {
    const h = await harness();
    const web = site(() => pdf("hello"));
    const client = createDownloadClient({ ...h.deps, fetch: web.fetch });

    await client.download(URL_A);
    await client.download(URL_A);
    await client.download("https://files.example.org/orders/b.pdf");

    expect(web.calls.map((call) => call.url)).toEqual([
      "https://files.example.org/",
      URL_A,
      "https://files.example.org/orders/b.pdf",
    ]);
  });

  test("lists each download of a URL that later serves a different file", async () => {
    const h = await harness();
    let body = "hello";
    const web = site(() => pdf(body));
    const client = createDownloadClient({ ...h.deps, fetch: web.fetch });

    await client.download(URL_A, { refreshAfterMs: 1000 });
    h.advance(1000);
    body = "world";
    await client.download(URL_A, { refreshAfterMs: 1000 });
    h.advance(1000);
    await client.download(URL_A, { refreshAfterMs: 1000 });

    expect(
      (await h.outcomes(downloadRequest(URL_A))).map((outcome) => [
        outcome.completedAt,
        outcome.file,
      ]),
    ).toEqual([
      ["2026-11-17T12:00:00.000Z", HELLO],
      ["2026-11-17T12:00:01.000Z", WORLD],
      ["2026-11-17T12:00:02.000Z", WORLD],
    ]);
    expect(await h.binaryFileNames()).toEqual([
      `${HELLO}.BinaryFile.yaml`,
      `${HELLO}.pdf`,
      `${WORLD}.BinaryFile.yaml`,
      `${WORLD}.pdf`,
    ]);
  });

  test("a 404 or a 403 for one file is that file's failure, and the next file is fetched", async () => {
    const h = await harness();
    const web = site((url) =>
      url.endsWith("missing.pdf")
        ? { status: 404 }
        : url.endsWith("forbidden.pdf")
          ? { status: 403 }
          : pdf("hello"),
    );
    const client = createDownloadClient({ ...h.deps, fetch: web.fetch });

    const missing = await client.download(
      "https://files.example.org/missing.pdf",
    );
    const forbidden = await client.download(
      "https://files.example.org/forbidden.pdf",
    );
    const present = await client.download(URL_A);

    expect(missing).toMatchObject({
      status: "failed",
      error: {
        kind: "item",
        message: "HTTP 404 for https://files.example.org/missing.pdf",
      },
      outcome: { httpStatus: 404 },
    });
    expect(forbidden).toMatchObject({
      status: "failed",
      outcome: { httpStatus: 403 },
    });
    expect(present.status).toBe("succeeded");
    expect(client.skips()).toEqual([]);
  });

  test("a host that does not answer at the start stops the command", async () => {
    const h = await harness();
    const web = fakeFetch(() => new TypeError("fetch failed"));
    const client = createDownloadClient({ ...h.deps, fetch: web.fetch });

    await expect(client.download(URL_A)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    await expect(client.download(URL_A)).rejects.toThrow(
      "download files.example.org is not available: no answer from files.example.org (fetch failed).",
    );
    expect(await h.callResultCount()).toBe(0);
  });

  test("a host that goes down is skipped; another host is still used", async () => {
    const h = await harness();
    const web = fakeFetch((url) => {
      const { host, pathname } = new URL(url);
      if (pathname === "/") return { status: 200 };
      return host === "down.example.org"
        ? { status: 503, headers: { "retry-after": "600" } }
        : pdf("hello");
    });
    const client = createDownloadClient({
      ...h.deps,
      fetch: web.fetch,
      maxRetries: 1,
      maxBackoffMs: 10,
    });

    const first = await client.download("https://down.example.org/a.pdf");
    const second = await client.download("https://down.example.org/b.pdf");
    const elsewhere = await client.download(URL_A);

    // One retry 10 ms later, then the outcome is Retry-After (600 s) after it.
    const retryAfter = "2026-11-17T12:10:00.010Z";
    expect(first).toEqual({
      status: "skipped",
      service: "download down.example.org",
      retryAfter,
    });
    expect(second).toEqual(first);
    expect(elsewhere.status).toBe("succeeded");
    expect(
      web.calls.filter((call) => call.url.endsWith("/b.pdf")),
    ).toHaveLength(0);
    expect(client.skips()).toEqual([
      {
        service: "download down.example.org",
        downAt: "2026-11-17T12:00:00.010Z",
        skipped: 2,
        retryAfter,
      },
    ]);
  });

  test("uses a caller's fetch for the check and the download", async () => {
    const h = await harness();
    const shared = fakeFetch(() => new Error("the shared fetch was used"));
    const session = site(() => ({
      status: 200,
      body: "hello",
      headers: { "content-type": "application/octet-stream" },
    }));
    const client = createDownloadClient({ ...h.deps, fetch: shared.fetch });

    const result = await client.download(
      "https://files.example.org/photo.WEBP",
      { fetch: session.fetch },
    );

    if (result.status !== "succeeded") throw new Error(result.status);
    expect(result.file.envelope.spec.extension).toBe("webp");
    expect(result.file.envelope.spec.contentType).toBe(
      "application/octet-stream",
    );
    expect(shared.calls).toEqual([]);
    expect(session.calls).toHaveLength(2);
  });
});
