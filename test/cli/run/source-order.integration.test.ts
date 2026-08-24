import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { matchSourceIds } from "../../../src/cli/source-glob.js";
import { loadSourceProduces } from "../../../src/cli/run/load-source-module.js";
import { planSourceOrder } from "../../../src/cli/run/source-order.js";

const sourcesRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../sources",
);

describe("source run order over the real sources", () => {
  it("orders every source so its producers run first", async () => {
    const ids = await matchSourceIds(sourcesRoot, "*");
    const sources = await Promise.all(
      ids.map(async (id) => ({
        id,
        produces: await loadSourceProduces(id, sourcesRoot),
      })),
    );

    const { order } = planSourceOrder(sources);

    // Independent oracle: hand-derived from each source's declared produces and
    // the FK graph (see the derive-source-run-order design doc).
    expect(order).toEqual([
      "us-census-gazetteer",
      "gov.tx.tcole",
      "mn-post",
      "clearinghouse-api",
      "courtlistener",
      "gov.azpost.roster",
      "gov.us.federal-le",
    ]);

    // The shared helper dir is not a source.
    expect(ids).not.toContain("lib");
  });
});
