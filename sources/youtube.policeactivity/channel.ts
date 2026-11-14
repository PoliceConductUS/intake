import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// The configuration of this source: which channel it is, what it writes as the
// coverage link's source name, and how far back a run looks. None of it is
// settable from the environment — a run of this source means this channel and
// this window.
export const SOURCE_ID = "youtube.policeactivity";
export const CHANNEL_HANDLE = "@PoliceActivity";
export const CHANNEL_URL = "https://www.youtube.com/PoliceActivity";
export const SOURCE_NAME = "PoliceActivity";
export const WINDOW_YEARS = 5;

const CHANNEL_FILE = "channel.json";

type PersistedChannel = { handle: string; channelId: string };

async function readPersistedChannelId(
  stateDir: string,
): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(stateDir, CHANNEL_FILE), "utf8");
  } catch {
    return null;
  }
  const parsed = JSON.parse(raw) as Partial<PersistedChannel>;
  const channelId = parsed.channelId;
  if (typeof channelId !== "string" || channelId.trim() === "") {
    throw new Error(
      `${SOURCE_ID}: ${path.join(stateDir, CHANNEL_FILE)} holds no channelId; delete it to re-resolve ${CHANNEL_HANDLE}.`,
    );
  }
  return channelId;
}

/**
 * The channel's stable id: resolved from the declared handle, persisted in the
 * source's state dir, and asserted on every later run. A handle that starts
 * resolving to a different channel halts the run — mixing two channels' videos
 * under one namespace would misattribute every link made from them.
 */
export async function stableChannelId(
  stateDir: string,
  resolveChannelId: (handle: string) => Promise<string | null>,
): Promise<string> {
  const resolved = await resolveChannelId(CHANNEL_HANDLE);
  if (resolved === null || resolved.trim() === "") {
    throw new Error(
      `${SOURCE_ID}: ${CHANNEL_HANDLE} resolved to no channel id.`,
    );
  }
  const persisted = await readPersistedChannelId(stateDir);
  if (persisted !== null && persisted !== resolved) {
    throw new Error(
      `${SOURCE_ID}: ${CHANNEL_HANDLE} now resolves to channel ${resolved} but this source already ingested channel ${persisted}. Resolve which channel is official before acquiring again.`,
    );
  }
  if (persisted === null) {
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      path.join(stateDir, CHANNEL_FILE),
      `${JSON.stringify({ handle: CHANNEL_HANDLE, channelId: resolved } satisfies PersistedChannel, null, 2)}\n`,
    );
  }
  return resolved;
}
