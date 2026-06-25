import { parseDatabaseMutationKind } from "./DatabaseMutation.js";

export type DatabaseMutationCounts = {
  mutations: number;
  recordsByEntityType: Record<string, number>;
};

export type DatabaseMutationCountable =
  | {
      kind: string;
    }
  | {
      ref: {
        kind: string;
      };
    };

export function emptyDatabaseMutationCounts(): DatabaseMutationCounts {
  return {
    mutations: 0,
    recordsByEntityType: {},
  };
}

export function incrementDatabaseMutationCounts(
  counts: DatabaseMutationCounts,
  mutation: DatabaseMutationCountable,
): void {
  const kind = "kind" in mutation ? mutation.kind : mutation.ref.kind;
  const { recordKind } = parseDatabaseMutationKind(kind);
  counts.mutations += 1;
  counts.recordsByEntityType[recordKind] =
    (counts.recordsByEntityType[recordKind] ?? 0) + 1;
}

export function countDatabaseMutations(
  mutations: readonly DatabaseMutationCountable[],
): DatabaseMutationCounts {
  const counts = emptyDatabaseMutationCounts();
  for (const mutation of mutations) {
    incrementDatabaseMutationCounts(counts, mutation);
  }
  return counts;
}

export function formatDatabaseMutationCountLines(
  counts: DatabaseMutationCounts,
): string[] {
  return [
    `Database mutations: ${counts.mutations}`,
    ...Object.entries(counts.recordsByEntityType)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([recordKind, count]) => `${recordKind}: ${count}`),
  ];
}
