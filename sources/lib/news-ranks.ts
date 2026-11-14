import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { pathToFileURL } from "node:url";

function domainNames(host: string) {
  const labels = host.toLowerCase().split(".");
  return labels.slice(1).map((_, index) => labels.slice(index).join("."));
}

export function domainRankFor(url: string, ranks: Record<string, number>) {
  for (const domain of domainNames(new URL(url).hostname)) {
    if (Object.hasOwn(ranks, domain)) return ranks[domain];
  }
}

export async function readDomainRanks(
  lines: AsyncIterable<string>,
  hosts: string[],
) {
  const domains = new Set(hosts.flatMap(domainNames));
  const ranks: Record<string, number> = {};
  let first = true;
  for await (const line of lines) {
    const fields = line.split("\t");
    if (first) {
      first = false;
      if (fields[0] !== "#harmonicc_pos" || fields[4] !== "#host_rev")
        throw Error("Expected a Common Crawl domain ranking snapshot");
      continue;
    }
    const domain = fields[4]!.split(".").reverse().join(".");
    if (domains.delete(domain)) {
      const rank = Number(fields[0]);
      if (!Number.isSafeInteger(rank) || rank < 1)
        throw Error("Invalid Common Crawl rank");
      ranks[domain] = rank;
    }
    if (!domains.size) break;
  }
  return ranks;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const [snapshot, ...hosts] = process.argv.slice(2);
  if (!snapshot || !hosts.length)
    throw Error(
      "Supply a downloaded domain-ranks.txt.gz file and publisher hostnames",
    );
  const lines = createInterface({
    input: createReadStream(snapshot).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  console.log(JSON.stringify(await readDomainRanks(lines, hosts)));
}
