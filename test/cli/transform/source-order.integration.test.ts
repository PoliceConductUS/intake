import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { matchSourceIds } from "../../../src/cli/source-glob.js";
import { loadSourceProduces } from "../../../src/cli/transform/load-source-module.js";
import {
  consumesOf,
  planSourceOrder,
} from "../../../src/cli/transform/source-order.js";

const sourcesRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../sources",
);

describe("source run order over the real sources", () => {
  it("runs every source after the producers of what it consumes", async () => {
    const ids = await matchSourceIds(sourcesRoot, "*");
    const sources = await Promise.all(
      ids.map(async (id) => ({
        id,
        produces: await loadSourceProduces(id, sourcesRoot),
      })),
    );

    const { order, skipped } = planSourceOrder(sources);

    // The order is computed, never fixed: asserting one exact sequence would pin
    // the sort's arbitrary tie-break between independent sources (e.g. two sinks
    // ordered by id), which a rename can flip without changing correctness. The
    // real guarantee (ADR 0021) is the only thing asserted — every producer of a
    // kind a source consumes appears before it. The FK graph is the independent
    // oracle; the sort's output is checked against it.
    const positionOf = new Map(order.map((id, index) => [id, index]));
    const producing = sources.filter((source) => source.produces.length > 0);

    // Every producing source is placed exactly once; produce-nothing sources are
    // skipped, not ordered.
    expect([...order].sort()).toEqual(producing.map((s) => s.id).sort());
    expect(skipped).toEqual(
      sources
        .filter((source) => source.produces.length === 0)
        .map((source) => source.id)
        .sort((left, right) => left.localeCompare(right)),
    );

    for (const consumer of producing) {
      for (const consumedKind of consumesOf(consumer.produces)) {
        for (const producer of producing) {
          if (producer.id === consumer.id) continue;
          if (!producer.produces.includes(consumedKind)) continue;
          expect(
            positionOf.get(producer.id),
            `${producer.id} produces ${consumedKind} consumed by ${consumer.id}, so it must run first`,
          ).toBeLessThan(positionOf.get(consumer.id)!);
        }
      }
    }

    // The shared helper dir is not a source.
    expect(ids).not.toContain("lib");
  });
});
