import { setTimeout } from "node:timers/promises";
import { BASE_URL, postbackFields } from "./parse.js";
export type RequestHtml = (
  url: string,
  body?: URLSearchParams,
) => Promise<string>;
export function createClient(
  options: {
    fetch?: typeof fetch;
    delayMs?: number;
    onSessionRenewal?: () => void;
  } = {},
): RequestHtml {
  const transport = options.fetch ?? fetch;
  const cookies = new Map<string, string>();
  let lastRequest = 0;
  const send = async (
    url: string,
    body?: URLSearchParams,
  ): Promise<Response> => {
    if (new URL(url).origin !== new URL(BASE_URL).origin)
      throw Error("Unexpected acquisition origin");
    await setTimeout(
      Math.max(0, (options.delayMs ?? 250) - (Date.now() - lastRequest)),
    );
    lastRequest = Date.now();
    const response = await transport(url, {
      method: body ? "POST" : "GET",
      body,
      headers: {
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(body
          ? { "content-type": "application/x-www-form-urlencoded" }
          : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(45000),
    }).catch((error: unknown) => {
      const detail =
        error instanceof Error
          ? `${error.message}; ${String(error.cause ?? "")}`
          : String(error);
      throw new Error(
        `Oregon request failed: ${body ? "POST" : "GET"} ${url}: ${detail}`,
        { cause: error },
      );
    });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";")[0]!;
      const split = pair.indexOf("=");
      if (split > 0) cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return response;
  };
  const requireSuccess = async (response: Response, url: string) => {
    if (!response.ok)
      throw Error(
        `Oregon request failed: HTTP ${response.status} ${url}; location=${response.headers.get("location") ?? "none"}`,
      );
    return response.text();
  };
  return async (url, body) => {
    let response = await send(url, body);
    const location = response.headers.get("location");
    if (
      response.status === 302 &&
      location &&
      new URL(location, url).href === new URL("Logout.aspx", BASE_URL).href
    ) {
      options.onSessionRenewal?.();
      const searchUrl = new URL("EmployeeSearch.aspx", BASE_URL).href;
      const form = await requireSuccess(await send(searchUrl), searchUrl);
      postbackFields(form);
      response = await send(url, body);
    }
    return requireSuccess(response, url);
  };
}
