import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const CACHE_FILE = "docket-cache.json";
export const REFRESH_DAYS = 120;

export type Docket = {
  id: string;
  case_name: string;
  docket_number: string;
  court: string;
  date_filed: string | null;
  date_terminated: string | null;
  cause: string;
  absolute_url: string;
  defendants: string[];
};

export type AgencyCacheEntry = {
  lastSearchedAt: string;
  dockets: Docket[];
};

export type DocketCache = {
  agencies: Record<string, AgencyCacheEntry>;
};

export async function loadDocketCache(stateDir: string): Promise<DocketCache> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(stateDir, CACHE_FILE), "utf8"),
    ) as DocketCache;
    return { agencies: parsed.agencies ?? {} };
  } catch {
    return { agencies: {} };
  }
}

export async function saveDocketCache(
  stateDir: string,
  cache: DocketCache,
): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    path.join(stateDir, CACHE_FILE),
    JSON.stringify(cache, null, 2),
  );
}

export function agencyNeedsSearch(
  entry: AgencyCacheEntry | undefined,
  nowMs: number,
  refreshDays: number = REFRESH_DAYS,
): boolean {
  if (entry === undefined) return true;
  const lastMs = Date.parse(entry.lastSearchedAt);
  if (!Number.isFinite(lastMs)) return true;
  return (nowMs - lastMs) / 86_400_000 > refreshDays;
}
