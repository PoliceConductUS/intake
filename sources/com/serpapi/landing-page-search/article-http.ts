import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { lookup } from "node:dns";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["192.0.0.0", 24],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(ip, bits);
const isPublic = (address: string) =>
  isIP(address) === 4
    ? !blocked.check(address, "ipv4")
    : /^[23][0-9a-f]{3}:/i.test(address);
type HttpStep = {
  url: string;
  status: number;
  contentType?: string;
  location?: string;
};
type ArticleRead = {
  url: string;
  html: string;
  responses?: HttpStep[];
  reason?: string;
};
async function readPublicArticle(
  input: string,
  responses: HttpStep[],
): Promise<ArticleRead | null> {
  let url = new URL(input);
  for (let i = 0; i < 8; i++) {
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && !isPublic(host)) return null;
    const response = await new Promise<import("node:http").IncomingMessage>(
      (resolve, reject) => {
        const get = url.protocol === "https:" ? httpsGet : httpGet;
        get(
          url,
          {
            signal: AbortSignal.timeout(20000),
            lookup(hostname, opts, done) {
              lookup(hostname, { ...opts, all: true }, (err, addresses) => {
                const allowed = addresses?.filter(({ address }) =>
                  isPublic(address),
                );
                if (err || !allowed?.length)
                  return done(err ?? new Error("No public address"), "", 0);
                if (opts.all) done(null, allowed);
                else done(null, allowed[0].address, allowed[0].family);
              });
            },
          },
          resolve,
        ).on("error", reject);
      },
    );
    responses.push({
      url: url.href,
      status: response.statusCode ?? 0,
      contentType: response.headers["content-type"],
      location: response.headers.location,
    });
    if (
      response.statusCode &&
      [301, 302, 303, 307, 308].includes(response.statusCode) &&
      response.headers.location
    ) {
      url = new URL(response.headers.location, url);
      response.destroy();
      continue;
    }
    const status = response.statusCode;
    const html = String(response.headers["content-type"]).includes("html");
    if (!html) {
      response.destroy();
      return {
        url: url.href,
        html: "",
        reason: "Non-HTML response (HTTP " + status + ")",
        responses,
      };
    }
    const chunks: Buffer[] = [];
    for await (const chunk of response) chunks.push(Buffer.from(chunk));
    return {
      url: url.href,
      html: Buffer.concat(chunks).toString("utf8"),
      responses,
      ...(status !== 200 && { reason: "Publisher HTTP " + status }),
    };
  }
  return null;
}

export async function readArticle(url: string): Promise<ArticleRead | null> {
  const responses: HttpStep[] = [];
  try {
    return (
      (await readPublicArticle(url, responses)) ?? {
        url,
        html: "",
        reason: "Publisher URL or redirect unavailable",
        responses,
      }
    );
  } catch (error) {
    // An unreachable publisher or invalid redirect does not exhaust the search.
    if (error instanceof Error)
      return { url, html: "", reason: error.message, responses };
    throw error;
  }
}
