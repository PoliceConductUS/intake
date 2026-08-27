import { describe, it, expect } from "vitest";
import {
  resolveReference,
  type Disposition,
  type ReferenceIO,
} from "../../../sources/com.policeconduct.manual/reference.js";

// Scripts the interview I/O so the state machine is exercised without stdin: a
// queue of typed/searched values, a fixed known-mapping, and a queue of
// dispositions. `waits` counts the pauses.
function io(options: {
  values: (string | null)[];
  known: Record<string, string>;
  dispositions: Disposition[];
}): ReferenceIO & { waits: () => number } {
  let waitCount = 0;
  const values = [...options.values];
  const dispositions = [...options.dispositions];
  return {
    askValue: async () => values.shift() ?? null,
    resolve: async (value) => options.known[value],
    askDisposition: async () => dispositions.shift() ?? "stop",
    wait: async () => {
      waitCount += 1;
    },
    waits: () => waitCount,
  };
}

describe("resolveReference", () => {
  it("resolves a typed/selected value to its canonical id", async () => {
    const result = await resolveReference(
      io({
        values: ["ap-source-7"],
        known: { "ap-source-7": "canonical-42" },
        dispositions: [],
      }),
    );
    expect(result).toEqual({ canonicalId: "canonical-42" });
  });

  it("skips the reference when the user cancels and chooses skip", async () => {
    const result = await resolveReference(
      io({ values: [null], known: {}, dispositions: ["skip"] }),
    );
    expect(result).toEqual({ skipped: true });
  });

  it("stops the acquire when the value is unknown and the user chooses stop", async () => {
    await expect(
      resolveReference(
        io({ values: ["nope"], known: {}, dispositions: ["stop"] }),
      ),
    ).rejects.toThrow(/stopped by the user/);
  });

  it("waits and retries — the target appears on the second search", async () => {
    const context = io({
      // First search misses; after the wait, the same value is found.
      values: ["pending-ref", "pending-ref"],
      known: { "pending-ref": "canonical-9" },
      dispositions: ["wait"],
    });
    // Make the first resolve miss, the second hit: flip known after the first
    // askValue by wrapping resolve.
    let seen = 0;
    const gated: ReferenceIO = {
      ...context,
      resolve: async (value) => {
        seen += 1;
        return seen >= 2 ? "canonical-9" : undefined;
      },
    };
    const result = await resolveReference(gated);
    expect(result).toEqual({ canonicalId: "canonical-9" });
    expect(context.waits()).toBe(1);
  });
});
