import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import {
  CHANNEL_HANDLE,
  stableChannelId,
} from "../../../sources/youtube.policeactivity/channel.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function stateDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "youtube-pa-state-"));
  dirs.push(dir);
  return dir;
}

const resolvesTo =
  (id: string | null) =>
  async (handle: string): Promise<string | null> => {
    expect(handle).toBe(CHANNEL_HANDLE);
    return id;
  };

describe("stableChannelId", () => {
  it("resolves the declared handle and persists the id on the first run", async () => {
    const state = await stateDir();
    expect(await stableChannelId(state, resolvesTo("UCpa123"))).toBe("UCpa123");
    expect(
      JSON.parse(await readFile(path.join(state, "channel.json"), "utf8")),
    ).toEqual({ handle: CHANNEL_HANDLE, channelId: "UCpa123" });
  });

  it("reuses the persisted id on a later run", async () => {
    const state = await stateDir();
    await stableChannelId(state, resolvesTo("UCpa123"));
    expect(await stableChannelId(state, resolvesTo("UCpa123"))).toBe("UCpa123");
  });

  it("halts the run when the handle starts resolving to another channel", async () => {
    const state = await stateDir();
    await stableChannelId(state, resolvesTo("UCpa123"));
    await expect(
      stableChannelId(state, resolvesTo("UCimposter")),
    ).rejects.toThrow(/UCimposter.*already ingested channel UCpa123/s);
  });

  it("halts the run when the handle resolves to no channel", async () => {
    await expect(
      stableChannelId(await stateDir(), resolvesTo(null)),
    ).rejects.toThrow(/resolved to no channel id/);
  });

  it("fails loudly on a persisted file that holds no channel id", async () => {
    const state = await stateDir();
    await writeFile(path.join(state, "channel.json"), '{"handle":"@x"}');
    await expect(stableChannelId(state, resolvesTo("UCpa123"))).rejects.toThrow(
      /holds no channelId/,
    );
  });
});
