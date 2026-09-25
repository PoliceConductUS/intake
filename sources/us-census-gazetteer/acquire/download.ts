import {
  copyFile,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { GazetteerLinks } from "./discovery.js";
import { verifyZipContents } from "../../../src/cli/transform/parse/zip.js";

export type DownloadLogger = { info: (message: string) => void };
export type FetchBytes = (url: string) => Promise<Uint8Array>;
export type RemoteTail = {
  bytes: Uint8Array;
  totalSize: number;
  full: boolean;
};

export function gazetteerSourceUrls(links: GazetteerLinks): string[] {
  return [
    links.stateUrl,
    links.administrativeAreaUrl,
    links.placesUrl,
    links.stateTigerUrl,
    links.countyTigerUrl,
    ...links.placeTigerUrls,
    ...links.countySubdivisionTigerUrls,
    ...links.consolidatedCityTigerUrls,
    ...(links.hierarchyUrl ? [links.hierarchyUrl] : []),
  ];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

// A ZIP's final 65,557 bytes contain its end record and usually all entry CRCs.
// Only use that tail when the entire ordinary ZIP central directory is present.
function containsCentralDirectory(tail: Buffer, totalSize: number): boolean {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== 0x06054b50) continue;
    if (i + 22 + tail.readUInt16LE(i + 20) !== tail.length) continue;
    const size = tail.readUInt32LE(i + 12);
    const offset = tail.readUInt32LE(i + 16);
    return (
      tail.readUInt32LE(i + 4) === 0 &&
      tail.readUInt16LE(i + 8) === tail.readUInt16LE(i + 10) &&
      tail.readUInt16LE(i + 10) !== 0xffff &&
      offset >= totalSize - tail.length &&
      offset + size === totalSize - tail.length + i
    );
  }
  return false;
}

async function matchesRemoteZip(
  file: string,
  remote: RemoteTail,
): Promise<boolean> {
  if ((await stat(file)).size !== remote.totalSize) return false;
  const tail = Buffer.from(remote.bytes);
  if (!containsCentralDirectory(tail, remote.totalSize)) return false;
  const handle = await open(file, "r");
  try {
    const local = Buffer.alloc(tail.length);
    const { bytesRead } = await handle.read(
      local,
      0,
      local.length,
      remote.totalSize - tail.length,
    );
    if (bytesRead !== tail.length || !local.equals(tail)) return false;
  } finally {
    await handle.close();
  }
  try {
    await verifyZipContents(file);
    return true;
  } catch {
    return false;
  }
}

export async function downloadGazetteerSources({
  sourceDir,
  previousSourceDirs = [],
  urls,
  fetchBytes,
  fetchRange,
  logger,
}: {
  sourceDir: string;
  previousSourceDirs?: readonly string[];
  urls: readonly string[];
  fetchBytes: FetchBytes;
  fetchRange: (url: string) => Promise<RemoteTail>;
  logger: DownloadLogger;
}): Promise<void> {
  await mkdir(sourceDir, { recursive: true });
  const selectedNames = new Set(
    urls.map((url) => path.basename(new URL(url).pathname)),
  );
  for (const file of await readdir(sourceDir)) {
    if (file.endsWith(".zip") && !selectedNames.has(file)) {
      await rm(path.join(sourceDir, file));
    }
  }
  for (const [index, url] of urls.entries()) {
    const fileName = path.basename(new URL(url).pathname);
    const destination = path.join(sourceDir, fileName);
    const position = `[${index + 1}/${urls.length}]`;
    const candidates: string[] = [];
    for (const dir of [sourceDir, ...previousSourceDirs]) {
      const file = path.join(dir, fileName);
      if (await fileExists(file)) candidates.push(file);
    }
    let bytes: Uint8Array | undefined;
    let matchingFile: string | undefined;
    if (candidates.length && fileName.endsWith(".zip")) {
      const remote = await fetchRange(url);
      if (remote.full) bytes = remote.bytes;
      else
        for (const candidate of candidates) {
          if (await matchesRemoteZip(candidate, remote)) {
            matchingFile = candidate;
            break;
          }
        }
    }
    const temporary = `${destination}.partial`;
    if (matchingFile) {
      if (matchingFile !== destination) {
        await copyFile(matchingFile, temporary);
        await rename(temporary, destination);
      }
      logger.info(`census: ${position} reused verified ${fileName}`);
      continue;
    }
    logger.info(`census: ${position} downloading ${fileName}`);
    await writeFile(temporary, bytes ?? (await fetchBytes(url)));
    await rename(temporary, destination);
  }
}
