import { rowsFromResult, type DatabaseClient } from "./index.js";
import {
  TABLE_BY_KIND,
  PRIMARY_KEY_BY_KIND,
} from "../../shared/io/generated/entity-specs.js";
import {
  AGENCY_CASE_ROOT,
  AGENCY_GRAPH_COLUMNS,
  AGENCY_GRAPH_EDGES,
  AGENCY_GRAPH_ROOT,
  graphKey,
  overlayAgencyGraph,
  type AgencyGraphRecord,
} from "../import/artifacts/agency-graph.js";

/** Read only current candidates, their inclusion ancestors, and root witnesses. */
export async function readExistingAgencyGraph(
  client: DatabaseClient,
  incoming: readonly AgencyGraphRecord[],
): Promise<AgencyGraphRecord[]> {
  const candidates = incoming.filter((record) =>
    AGENCY_GRAPH_COLUMNS.has(record.kind),
  );
  const replacements = overlayAgencyGraph([], candidates);
  const existing = new Map<string, AgencyGraphRecord>();
  const effective = overlayAgencyGraph([], candidates);
  const queried = new Map<string, Set<string>>();

  function projection(kind: string, alias?: string): string {
    return [PRIMARY_KEY_BY_KIND[kind]!, ...AGENCY_GRAPH_COLUMNS.get(kind)!]
      .map((column) => (alias ? `${alias}.${column}` : column))
      .join(", ");
  }

  function remember(
    kind: string,
    rows: Record<string, unknown>[],
  ): AgencyGraphRecord[] {
    return rows.map((values) => {
      const record = {
        kind,
        id: String(values[PRIMARY_KEY_BY_KIND[kind]!]),
        values,
      };
      const key = graphKey(record);
      existing.set(key, record);
      const replacement = replacements.get(key);
      const overlaid = overlayAgencyGraph(
        [record],
        replacement ? [replacement] : [],
      ).get(key)!;
      effective.set(key, overlaid);
      const identityQuery = `${kind}:${PRIMARY_KEY_BY_KIND[kind]}`;
      const identities = queried.get(identityQuery) ?? new Set<string>();
      identities.add(record.id);
      queried.set(identityQuery, identities);
      return overlaid;
    });
  }

  async function read(
    kind: string,
    column: string,
    ids: readonly string[],
  ): Promise<AgencyGraphRecord[]> {
    const key = `${kind}:${column}`;
    const seen = queried.get(key) ?? new Set<string>();
    const pending = [...new Set(ids)].filter((id) => !seen.has(id));
    if (pending.length === 0) return [];
    pending.forEach((id) => seen.add(id));
    queried.set(key, seen);
    return remember(
      kind,
      rowsFromResult(
        await client.query(
          `select ${projection(kind)} from ${TABLE_BY_KIND[kind]} where ${column} = any($1)`,
          [pending],
        ),
      ),
    );
  }

  const byKind = new Map<string, string[]>();
  for (const record of candidates) {
    const ids = byKind.get(record.kind) ?? [];
    ids.push(record.id);
    byKind.set(record.kind, ids);
  }
  for (const [kind, ids] of byKind)
    await read(kind, PRIMARY_KEY_BY_KIND[kind]!, ids);

  // Admission considers both snapshots, so discover parents from both sets of edges.
  let frontier = [...effective.values()];
  const visited = new Set(frontier.map(graphKey));
  while (frontier.length > 0) {
    const next: AgencyGraphRecord[] = [];
    const enqueue = (record: AgencyGraphRecord) => {
      const key = graphKey(record);
      if (visited.has(key)) return;
      visited.add(key);
      next.push(record);
    };
    for (const edge of AGENCY_GRAPH_EDGES) {
      const children = frontier
        .filter((record) => record.kind === edge.child)
        .flatMap((record) => {
          const stored = existing.get(graphKey(record));
          return stored ? [stored, record] : [record];
        });
      if (children.length === 0) continue;
      if (edge.holder === "child") {
        const ids = children
          .map((record) => record.values[edge.field])
          .filter((id): id is string => typeof id === "string");
        await read(edge.parent, PRIMARY_KEY_BY_KIND[edge.parent]!, ids);
        for (const id of ids) {
          const parent = effective.get(graphKey({ kind: edge.parent, id }));
          if (parent) enqueue(parent);
        }
      } else {
        const ids = new Set(children.map((record) => record.id));
        for (const parent of await read(edge.parent, edge.field, [...ids])) {
          enqueue(parent);
        }
      }
    }
    frontier = next;
  }

  // Witnesses qualify encountered agencies; they must not expand the ancestor walk.
  const agencyIds = [...effective.values()]
    .filter((record) => record.kind === AGENCY_GRAPH_ROOT.kind)
    .map((record) => record.id);
  const agencyIdSet = new Set(agencyIds);
  if (agencyIds.length > 0) {
    const kind = AGENCY_GRAPH_ROOT.assignmentKind;
    remember(
      kind,
      rowsFromResult(
        await client.query(
          `select ${projection(kind)} from ${TABLE_BY_KIND[kind]} where ${AGENCY_GRAPH_ROOT.agencyField} = any($1) and ${AGENCY_GRAPH_ROOT.endField} is null`,
          [agencyIds],
        ),
      ),
    );

    const caseRoot = AGENCY_CASE_ROOT;
    const currentAssignmentIds = [...effective.values()]
      .filter(
        (record) =>
          record.kind === kind &&
          agencyIdSet.has(String(record.values[AGENCY_GRAPH_ROOT.agencyField])),
      )
      .map((record) => record.id);
    remember(
      caseRoot.linkKind,
      rowsFromResult(
        await client.query(
          `select ${projection(caseRoot.linkKind, "link")} from ${TABLE_BY_KIND[caseRoot.linkKind]} link join ${TABLE_BY_KIND[kind]} assignment on assignment.${PRIMARY_KEY_BY_KIND[kind]} = link.${caseRoot.assignmentField} where assignment.${AGENCY_GRAPH_ROOT.agencyField} = any($1) or link.${caseRoot.assignmentField} = any($2)`,
          [agencyIds, currentAssignmentIds],
        ),
      ),
    );
    const caseLinks = [...existing.values(), ...effective.values()].filter(
      (record) => record.kind === caseRoot.linkKind,
    );
    const assignmentIds = caseLinks
      .map((record) => record.values[caseRoot.assignmentField])
      .filter((id): id is string => typeof id === "string");
    await read(kind, PRIMARY_KEY_BY_KIND[kind]!, assignmentIds);
    const caseIds = caseLinks
      .filter((record) => {
        const assignmentId = record.values[caseRoot.assignmentField];
        if (typeof assignmentId !== "string") return false;
        const key = graphKey({ kind, id: assignmentId });
        return [existing.get(key), effective.get(key)].some((assignment) =>
          agencyIdSet.has(
            String(assignment?.values[AGENCY_GRAPH_ROOT.agencyField]),
          ),
        );
      })
      .map((record) => record.values[caseRoot.caseField])
      .filter((id): id is string => typeof id === "string");
    await read(
      caseRoot.caseKind,
      PRIMARY_KEY_BY_KIND[caseRoot.caseKind]!,
      caseIds,
    );
  }
  return [...existing.values()];
}
