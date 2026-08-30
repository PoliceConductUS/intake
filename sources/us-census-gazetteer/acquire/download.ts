import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GazetteerLinks } from "./discovery.js";

export type DownloadLogger = { info: (message: string) => void };
export type FetchBytes = (url: string) => Promise<Uint8Array>;

export function gazetteerSourceUrls(links: GazetteerLinks): string[] {
  return [
    links.stateUrl,
    links.administrativeAreaUrl,
    links.placesUrl,
    links.stateTigerUrl,
    links.countyTigerUrl,
    ...links.placeTigerUrls,
    ...(links.hierarchyUrl ? [links.hierarchyUrl] : []),
  ];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function downloadGazetteerSources({
  sourceDir,
  urls,
  fetchBytes,
  logger,
}: {
  sourceDir: string;
  urls: readonly string[];
  fetchBytes: FetchBytes;
  logger: DownloadLogger;
}): Promise<void> {
  await mkdir(sourceDir, { recursive: true });
  for (const [index, url] of urls.entries()) {
    const fileName = path.basename(new URL(url).pathname);
    const destination = path.join(sourceDir, fileName);
    const position = `[${index + 1}/${urls.length}]`;
    if (await fileExists(destination)) {
      logger.info(`census: ${position} have ${fileName}`);
      continue;
    }
    logger.info(`census: ${position} downloading ${fileName}`);
    await writeFile(destination, await fetchBytes(url));
  }
}
