import { describe, it, expect } from "vitest";
import {
  resolveReference,
  type Disposition,
  type ReferenceIO,
} from "../../../sources/com.policeconduct.manual/reference.js";

// Scripts the interview I/O so the state machine is exercised without stdin: a
// queue of resolved source ids (null = no match / cancel) and a queue of
// dispositions. `waits` counts the pauses.
function io(options: {
  sourceIds: (string | null)[];
  dispositions: Disposition[];
}): ReferenceIO & { waits: () => number } {
  let waitCount = 0;
  const sourceIds = [...options.sourceIds];
  const dispositions = [...options.dispositions];
  return {
    getSourceId: async () => (sourceIds.length > 0 ? sourceIds.shift()! : null),
    askDisposition: async () => dispositions.shift() ?? "stop",
    wait: async () => {
      waitCount += 1;
    },
    waits: () => waitCount,
  };
}

describe("resolveReference", () => {
  it("returns the resolved source id (canonical never leaves the data context)", async () => {
    const result = await resolveReference(
      io({ sourceIds: ["ap-src-7"], dispositions: [] }),
    );
    expect(result).toEqual({ sourceId: "ap-src-7" });
  });

  it("skips the reference when nothing matched and the user chooses skip", async () => {
    const result = await resolveReference(
      io({ sourceIds: [null], dispositions: ["skip"] }),
    );
    expect(result).toEqual({ skipped: true });
  });

  it("stops the acquire when nothing matched and the user chooses stop", async () => {
    await expect(
      resolveReference(io({ sourceIds: [null], dispositions: ["stop"] })),
    ).rejects.toThrow(/stopped by the user/);
  });

  it("waits and retries — the target resolves on the second search", async () => {
    const context = io({
      sourceIds: [null, "ap-src-9"],
      dispositions: ["wait"],
    });
    const result = await resolveReference(context);
    expect(result).toEqual({ sourceId: "ap-src-9" });
    expect(context.waits()).toBe(1);
  });
});
