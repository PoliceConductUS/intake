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
};

// FK_REFERENCES is keyed by singular record kind (e.g. "CivilCaseOfficer");
// sources declare plural ImportArtifactKind (e.g. "CivilCaseOfficers"). The
// registry carries both names per kind, so map through it.
const KIND_BY_RECORD_KIND = new Map<string, ImportArtifactKind>(
  Object.values(importTypeMetadata).map((meta) => [meta.recordKind, meta.kind]),
);

/**
 * The kinds a source consumes: the foreign-key targets (per the generated,
 * DB-introspected `FK_REFERENCES`) of its produced kinds that it does not itself
 * produce. These are a source's *direct* FK targets — transitivity is the sort's
 * job, not this set's (ADR 0021).
 */
export function consumesOf(
  produces: readonly ImportArtifactKind[],
): ImportArtifactKind[] {
  const produced = new Set(produces);
  const consumed = new Set<ImportArtifactKind>();
  for (const kind of produces) {
    const recordKind = importTypeMetadata[kind].recordKind;
    for (const reference of FK_REFERENCES[recordKind] ?? []) {
      const targetKind = KIND_BY_RECORD_KIND.get(reference.targetKind);
      if (targetKind !== undefined && !produced.has(targetKind)) {
        consumed.add(targetKind);
      }
    }
  }
  return [...consumed];
}

/**
 * Kahn topological sort over `nodes` with labelled `edges` (before → after).
 * Ties among ready nodes break by descending out-degree (a node more others
 * depend on comes first), then ascending id — fully deterministic. A cycle
 * throws, naming the nodes still in the cycle and the labels on their edges.
 */
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

/**
 * Deterministic run order for a set of sources: a topological sort where source
 * A precedes source B when B's derived consumed set intersects A's `produces`
 * (ADR 0021). Sources with no ordering constraint between them break ties by
 * descending out-degree, then by source id. A dependency cycle throws, naming
 * the cycle and the kinds on it.
 */
export function planSourceOrder(
  sources: readonly SourceProduces[],
): SourceOrderPlan {
  const producersOf = new Map<ImportArtifactKind, string[]>();
  for (const source of sources) {
    for (const kind of source.produces) {
      const producers = producersOf.get(kind);
      if (producers) producers.push(source.id);
      else producersOf.set(kind, [source.id]);
    }
  }

  const edges: OrderEdge[] = [];
  for (const consumer of sources) {
    for (const kind of consumesOf(consumer.produces)) {
      for (const producerId of producersOf.get(kind) ?? []) {
        if (producerId === consumer.id) continue;
        edges.push({ before: producerId, after: consumer.id, kind });
      }
    }
  }

  const order = topologicalOrder(
    sources.map((source) => source.id),
    edges.map((edge) => ({ ...edge, label: edge.kind })),
  );
  return { order, edges };
}
