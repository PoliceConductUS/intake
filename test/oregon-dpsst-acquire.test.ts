import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { acquireOregon } from "../sources/gov.or.dpsst/acquire.js";
import { createClient } from "../sources/gov.or.dpsst/client.js";
it("retains incomplete manifest and original response on parse failure", async () => {
  const sourceDir = await mkdtemp(path.join(tmpdir(), "oregon-test-"));
  let calls = 0;
  await expect(
    acquireOregon({
      sourceDir,
      prefixes: ["Z"],
      request: async () =>
        ++calls === 1
          ? '<input type="hidden" name="__VIEWSTATE" value="abc">'
          : "<html>broken</html>",
    }),
  ).rejects.toThrow();
  expect(
    JSON.parse(await readFile(path.join(sourceDir, "manifest.json"), "utf8")),
  ).toMatchObject({ complete: false, prefixes: ["Z"] });
  expect(await readFile(path.join(sourceDir, "search-Z-1.html"), "utf8")).toBe(
    "<html>broken</html>",
  );
});
it("keeps session cookies and propagates HTTP errors", async () => {
  const seen: string[] = [];
  const client = createClient({
    delayMs: 0,
    fetch: async (_url, init) => {
      seen.push(new Headers(init?.headers).get("cookie") ?? "");
      return new Response("ok", {
        status: seen.length === 3 ? 500 : 200,
        headers: { "set-cookie": "ASP.NET_SessionId=test; Path=/; HttpOnly" },
      });
    },
  });
  await client(
    "https://www.bpl-orsnapshot.net/PublicInquiry_CJ/EmployeeSearch.aspx",
  );
  await client(
    "https://www.bpl-orsnapshot.net/PublicInquiry_CJ/EmployeeSearch.aspx",
  );
  expect(seen).toEqual(["", "ASP.NET_SessionId=test"]);
  await expect(
    client(
      "https://www.bpl-orsnapshot.net/PublicInquiry_CJ/EmployeeSearch.aspx",
    ),
  ).rejects.toThrow(/500/);
});
it("acquires all detail tabs and linked agencies before marking complete", async () => {
  const { parse } = await import("node-html-parser");
  const fixture = async (name: string) =>
    readFile(
      new URL(`./fixtures/oregon-dpsst/${name}.html`, import.meta.url),
      "utf8",
    );
  const root = parse(await fixture("search"));
  root.querySelectorAll("tr.rowAlt,tr.ListFooter").forEach((e) => e.remove());
  const search = root.outerHTML.replace("65863", "13177");
  const state = '<input type="hidden" name="__VIEWSTATE" value="abc">';
  const calls: string[] = [];
  const sourceDir = await mkdtemp(path.join(tmpdir(), "oregon-test-"));
  await acquireOregon({
    sourceDir,
    prefixes: ["Z"],
    request: async (url, body) => {
      const u = new URL(url);
      calls.push(u.pathname);
      if (u.pathname.endsWith("EmployeeSearch.aspx"))
        return state + (body ? search : "");
      if (u.pathname.endsWith("AgencyList.aspx")) return fixture("agency");
      return state + (await fixture(body ? "certificates" : "employment"));
    },
  });
  const manifest = JSON.parse(
    await readFile(path.join(sourceDir, "manifest.json"), "utf8"),
  );
  expect(manifest).toMatchObject({
    complete: true,
    prefixes: ["Z"],
    searchFiles: ["search-Z-1.html"],
    officers: [
      {
        id: "13177",
        employmentFiles: ["officer-13177-employment-1.html"],
        certificateFiles: ["officer-13177-certificates-1.html"],
      },
    ],
    agencies: [{ id: "HBS", file: "agency-HBS.html" }],
  });
  expect(calls).toHaveLength(5);
  manifest.complete = false;
  await writeFile(
    path.join(sourceDir, "manifest.json"),
    JSON.stringify(manifest),
  );
  await acquireOregon({
    sourceDir,
    prefixes: ["Z"],
    request: async () => {
      throw Error("Completed evidence must not be fetched again");
    },
  });
  expect(
    JSON.parse(await readFile(path.join(sourceDir, "manifest.json"), "utf8"))
      .complete,
  ).toBe(true);
  manifest.officers[0].certificateFiles = [];
  manifest.agencies = [];
  await writeFile(
    path.join(sourceDir, "manifest.json"),
    JSON.stringify(manifest),
  );
  const resumed: string[] = [];
  await acquireOregon({
    sourceDir,
    prefixes: ["Z"],
    request: async (url, body) => {
      resumed.push(url);
      if (url.includes("EmployeeSearch")) {
        expect(body).toBeUndefined();
        return state;
      }
      if (url.includes("AgencyList")) return fixture("agency");
      return state + (await fixture(body ? "certificates" : "employment"));
    },
  });
  expect(resumed).toHaveLength(4);
  await expect(
    acquireOregon({
      sourceDir,
      prefixes: ["A"],
      request: async () => {
        throw Error("unexpected request");
      },
    }),
  ).rejects.toThrow(/scope/i);
  const savedManifest = JSON.parse(
    await readFile(path.join(sourceDir, "manifest.json"), "utf8"),
  );
  await writeFile(
    path.join(sourceDir, "officer-13177-employment-1.html"),
    "broken",
  );
  await expect(
    acquireOregon({
      sourceDir,
      prefixes: ["Z"],
      request: async () => {
        throw Error("unexpected network");
      },
    }),
  ).rejects.toThrow();
  expect(
    JSON.parse(await readFile(path.join(sourceDir, "manifest.json"), "utf8"))
      .officers,
  ).toEqual(savedManifest.officers);
  savedManifest.officers.push(savedManifest.officers[0]);
  await writeFile(
    path.join(sourceDir, "manifest.json"),
    JSON.stringify(savedManifest),
  );
  await expect(
    acquireOregon({
      sourceDir,
      prefixes: ["Z"],
      request: async () => {
        throw Error("unexpected network");
      },
    }),
  ).rejects.toThrow(/duplicate/i);
});
it("fails a search postback that repeats the same page", async () => {
  const sourceDir = await mkdtemp(path.join(tmpdir(), "oregon-test-"));
  const html = await readFile(
    new URL("./fixtures/oregon-dpsst/search.html", import.meta.url),
    "utf8",
  );
  await expect(
    acquireOregon({
      sourceDir,
      prefixes: ["Z"],
      request: async () =>
        '<input type="hidden" name="__VIEWSTATE" value="abc">' + html,
    }),
  ).rejects.toThrow("Repeated search page");
  expect(
    JSON.parse(await readFile(path.join(sourceDir, "manifest.json"), "utf8"))
      .complete,
  ).toBe(false);
});
it("rejects an unrelated agency response instead of completing", async () => {
  const { parse } = await import("node-html-parser");
  const fixture = async (name: string) =>
    readFile(
      new URL(`./fixtures/oregon-dpsst/${name}.html`, import.meta.url),
      "utf8",
    );
  const root = parse(await fixture("search"));
  root.querySelectorAll("tr.rowAlt,tr.ListFooter").forEach((e) => e.remove());
  const search = root.outerHTML.replace("65863", "13177");
  const state = '<input type="hidden" name="__VIEWSTATE" value="abc">';
  await expect(
    acquireOregon({
      sourceDir: await mkdtemp(path.join(tmpdir(), "oregon-test-")),
      prefixes: ["Z"],
      request: async (url, body) => {
        if (url.includes("EmployeeSearch.aspx"))
          return state + (body ? search : "");
        if (url.includes("AgencyList.aspx"))
          return (await fixture("agency")).replace(
            "Washington County Sheriff&#39;s Office",
            "Unrelated Agency",
          );
        return state + (await fixture(body ? "certificates" : "employment"));
      },
    }),
  ).rejects.toThrow(/agency identity/i);
});
it("renews an expired public session once and rejects unrelated redirects", async () => {
  const calls: string[] = [];
  const client = createClient({
    delayMs: 0,
    fetch: async (url) => {
      calls.push(String(url));
      if (calls.length === 1)
        return new Response(null, {
          status: 302,
          headers: { location: "/PublicInquiry_CJ/Logout.aspx" },
        });
      if (String(url).endsWith("EmployeeSearch.aspx"))
        return new Response(
          '<input type="hidden" name="__VIEWSTATE" value="fresh">',
        );
      return new Response("detail");
    },
  });
  await expect(
    client(
      "https://www.bpl-orsnapshot.net/PublicInquiry_CJ/EmployeeDetails.aspx?RecID=1",
    ),
  ).resolves.toBe("detail");
  expect(calls.map((url) => new URL(url).pathname)).toEqual([
    "/PublicInquiry_CJ/EmployeeDetails.aspx",
    "/PublicInquiry_CJ/EmployeeSearch.aspx",
    "/PublicInquiry_CJ/EmployeeDetails.aspx",
  ]);
  const unrelated = createClient({
    delayMs: 0,
    fetch: async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://example.org/" },
      }),
  });
  await expect(
    unrelated(
      "https://www.bpl-orsnapshot.net/PublicInquiry_CJ/EmployeeDetails.aspx",
    ),
  ).rejects.toThrow(/302/);
  const expired = createClient({
    delayMs: 0,
    fetch: async (url) =>
      String(url).endsWith("EmployeeSearch.aspx")
        ? new Response('<input type="hidden" name="__VIEWSTATE" value="fresh">')
        : new Response(null, {
            status: 302,
            headers: { location: "/PublicInquiry_CJ/Logout.aspx" },
          }),
  });
  await expect(
    expired(
      "https://www.bpl-orsnapshot.net/PublicInquiry_CJ/EmployeeDetails.aspx",
    ),
  ).rejects.toThrow(/302/);
});
it("preserves postback data and renewed cookies across session renewal", async () => {
  const body = new URLSearchParams({
    __VIEWSTATE: "original",
    __EVENTTARGET: "tab",
  });
  const requests: Array<{
    method: string | undefined;
    cookie: string;
    body: unknown;
  }> = [];
  const client = createClient({
    delayMs: 0,
    fetch: async (url, init) => {
      requests.push({
        method: init?.method,
        cookie: new Headers(init?.headers).get("cookie") ?? "",
        body: init?.body,
      });
      if (requests.length === 1)
        return new Response(null, {
          status: 302,
          headers: { location: "/PublicInquiry_CJ/Logout.aspx" },
        });
      if (String(url).endsWith("EmployeeSearch.aspx"))
        return new Response(
          '<input type="hidden" name="__VIEWSTATE" value="fresh">',
          { headers: { "set-cookie": "ASP.NET_SessionId=renewed; Path=/" } },
        );
      return new Response("certificates");
    },
  });
  await expect(
    client(
      "https://www.bpl-orsnapshot.net/PublicInquiry_CJ/EmployeeDetails.aspx",
      body,
    ),
  ).resolves.toBe("certificates");
  expect(requests[2]).toMatchObject({
    method: "POST",
    cookie: "ASP.NET_SessionId=renewed",
    body,
  });
  const invalid = createClient({
    delayMs: 0,
    fetch: async (url) =>
      String(url).endsWith("EmployeeSearch.aspx")
        ? new Response("broken")
        : new Response(null, {
            status: 302,
            headers: { location: "/PublicInquiry_CJ/Logout.aspx" },
          }),
  });
  await expect(
    invalid(
      "https://www.bpl-orsnapshot.net/PublicInquiry_CJ/EmployeeDetails.aspx",
      body,
    ),
  ).rejects.toThrow(/viewstate/i);
});
