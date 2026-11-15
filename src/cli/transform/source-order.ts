import { importTypeMetadata } from "../../shared/io/import-type-metadata.js";
import { FK_REFERENCES } from "../../shared/io/generated/entity-specs.js";
import type { ImportArtifactKind } from "../../shared/io/index.js";

export type SourceProduces = {
  id: string;
  produces: readonly ImportArtifactKind[];
};

export type OrderEdge = {
  before: string;
  after: string;
  kind: ImportArtifactKind;
};

export type SourceOrderPlan = {
  order: string[];
  edges: OrderEdge[];
  skipped: string[];
};

const kindByRecordKind = new Map<string, ImportArtifactKind>(
  Object.values(importTypeMetadata).map((meta) => [meta.recordKind, meta.kind]),
);

// A source's direct FK targets (from generated FK_REFERENCES) that it does not
// itself produce. Transitivity is the sort's job, not this set's (ADR 0021).
export function consumesOf(
  produces: readonly ImportArtifactKind[],
): ImportArtifactKind[] {
  const produced = new Set(produces);
  const consumed = new Set<ImportArtifactKind>();
  for (const kind of produces) {
    const recordKind = importTypeMetadata[kind].recordKind;
    for (const reference of FK_REFERENCES[recordKind] ?? []) {
      const targetKind = kindByRecordKind.get(reference.targetKind);
      if (targetKind !== undefined && !produced.has(targetKind)) {
        consumed.add(targetKind);
      }
    }
  }
  return [...consumed];
}

// Kahn topological sort; ready nodes drain by descending out-degree, then id.
// Throws on a cycle, naming the stuck nodes and the labels on their edges.
export function topologicalOrder(
  nodes: readonly string[],
  edges: ReadonlyArray<{ before: string; after: string; label?: string }>,
): string[] {
  const predecessors = new Map<string, Set<string>>();
  const successors = new Map<string, Set<string>>();
  for (const node of nodes) {
    predecessors.set(node, new Set());
    successors.set(node, new Set());
  }
  for (const edge of edges) {
    if (edge.before === edge.after) continue;
    predecessors.get(edge.after)!.add(edge.before);
    successors.get(edge.before)!.add(edge.after);
  }

  const outDegree = (id: string): number => successors.get(id)!.size;
  const indegree = new Map<string, number>(
    nodes.map((node) => [node, predecessors.get(node)!.size]),
  );
  const ready = nodes.filter((node) => indegree.get(node) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort((left, right) => {
      const byOutDegree = outDegree(right) - outDegree(left);
      return byOutDegree !== 0 ? byOutDegree : left.localeCompare(right);
    });
    const next = ready.shift()!;
    order.push(next);
    for (const successor of successors.get(next)!) {
      const remaining = indegree.get(successor)! - 1;
      indegree.set(successor, remaining);
      if (remaining === 0) ready.push(successor);
    }
  }

  if (order.length !== nodes.length) {
    const inCycle = nodes.filter((node) => !order.includes(node));
    const detail = edges
      .filter(
        (edge) => inCycle.includes(edge.before) && inCycle.includes(edge.after),
      )
      .map((edge) =>
        edge.label
          ? `${edge.before} → ${edge.after} (${edge.label})`
          : `${edge.before} → ${edge.after}`,
      )
      .join(", ");
    throw new Error(
      `Source dependency cycle among ${inCycle.join(", ")}: ${detail}`,
    );
  }
  return order;
}

// Run order: A precedes B when B consumes a kind A produces (ADR 0021). A source
// that produces nothing (disabled/no-op) can neither contribute nor be depended
// on, so it is dropped from the order and returned as `skipped` (id-sorted).
export function planSourceOrder(
  sources: readonly SourceProduces[],
): SourceOrderPlan {
  const active = sources.filter((source) => source.produces.length > 0);
  const skipped = sources
    .filter((source) => source.produces.length === 0)
    .map((source) => source.id)
    .sort((left, right) => left.localeCompare(right));

  const producersOf = new Map<ImportArtifactKind, string[]>();
  for (const source of active) {
    for (const kind of source.produces) {
      const producers = producersOf.get(kind);
      if (producers) producers.push(source.id);
      else producersOf.set(kind, [source.id]);
    }
  }

  const edges: OrderEdge[] = [];
  for (const consumer of active) {
    for (const kind of consumesOf(consumer.produces)) {
      for (const producerId of producersOf.get(kind) ?? []) {
        if (producerId === consumer.id) continue;
        edges.push({ before: producerId, after: consumer.id, kind });
      }
    }
  }

  const order = topologicalOrder(
    active.map((source) => source.id),
    edges.map((edge) => ({ ...edge, label: edge.kind })),
  );
  return { order, edges, skipped };
}
