import { FK_REFERENCES } from "../../../shared/io/generated/entity-specs.js";
/** Inclusion direction is domain metadata, distinct from FK dependency order. */
export const AGENCY_GRAPH_ROOT = {
  kind: "Agency",
  assignmentKind: "AgencyPersonnel",
  agencyField: "agency_id",
  endField: "end_date",
} as const;

export const AGENCY_CASE_ROOT = {
  linkKind: "CivilCasePersonnel",
  assignmentField: "agency_personnel_id",
  caseField: "civil_case_id",
  caseKind: "CivilCase",
} as const;

export type InclusionEdge = {
  parent: string;
  child: string;
  /** Which endpoint stores the foreign key to the other endpoint. */
  holder: "parent" | "child";
  field: string;
};

export const AGENCY_GRAPH_EDGES: readonly InclusionEdge[] = [
  {
    parent: "Agency",
    child: "AgencyPersonnel",
    holder: "child",
    field: "agency_id",
  },
  {
    parent: "Agency",
    child: "AgencyPhoneNumber",
    holder: "child",
    field: "agency_id",
  },
  {
    parent: "Agency",
    child: "AgencyLink",
    holder: "child",
    field: "agency_id",
  },
  {
    parent: "Agency",
    child: "FederalAgencyBranch",
    holder: "child",
    field: "agency_id",
  },
  {
    parent: "AgencyPersonnel",
    child: "Personnel",
    holder: "parent",
    field: "personnel_id",
  },
  {
    parent: "AgencyPersonnel",
    child: "License",
    holder: "parent",
    field: "license_id",
  },
  {
    parent: "Personnel",
    child: "License",
    holder: "child",
    field: "personnel_id",
  },
  {
    parent: "License",
    child: "LicenseAction",
    holder: "child",
    field: "license_id",
  },
  {
    parent: "AgencyPersonnel",
    child: "CivilCasePersonnel",
    holder: "child",
    field: "agency_personnel_id",
  },
  {
    parent: "CivilCasePersonnel",
    child: "CivilCase",
    holder: "parent",
    field: "civil_case_id",
  },
  {
    parent: "CivilCase",
    child: "CivilCaseLink",
    holder: "child",
    field: "civil_case_id",
  },
  {
    parent: "CivilCase",
    child: "CoverageLinkCivilCase",
    holder: "child",
    field: "civil_case_id",
  },
  {
    parent: "CoverageLinkCivilCase",
    child: "CoverageLink",
    holder: "parent",
    field: "coverage_link_id",
  },
  {
    parent: "AgencyPersonnel",
    child: "ReviewPersonnel",
    holder: "child",
    field: "agency_personnel_id",
  },
  {
    parent: "ReviewPersonnel",
    child: "Review",
    holder: "parent",
    field: "review_id",
  },
  {
    parent: "Review",
    child: "ReviewLink",
    holder: "child",
    field: "review_id",
  },
  {
    parent: "AgencyPersonnel",
    child: "DisciplineAgencyPersonnel",
    holder: "child",
    field: "agency_personnel_id",
  },
  {
    parent: "DisciplineAgencyPersonnel",
    child: "Discipline",
    holder: "parent",
    field: "discipline_id",
  },
  {
    parent: "AgencyPersonnel",
    child: "CoverageLinkAgencyPersonnel",
    holder: "child",
    field: "agency_personnel_id",
  },
  {
    parent: "CoverageLinkAgencyPersonnel",
    child: "CoverageLink",
    holder: "parent",
    field: "coverage_link_id",
  },
  {
    parent: "AgencyPersonnel",
    child: "ArrestProfile",
    holder: "child",
    field: "agency_personnel_id",
  },
];

/** Only these fields are needed for selection; unrelated properties stay lazy. */
export const AGENCY_GRAPH_COLUMNS = new Map<string, Set<string>>();
for (const edge of AGENCY_GRAPH_EDGES) {
  for (const kind of [edge.parent, edge.child]) {
    if (!AGENCY_GRAPH_COLUMNS.has(kind))
      AGENCY_GRAPH_COLUMNS.set(kind, new Set());
  }
  AGENCY_GRAPH_COLUMNS.get(edge[edge.holder])!.add(edge.field);
}
AGENCY_GRAPH_COLUMNS.get(AGENCY_GRAPH_ROOT.assignmentKind)!.add(
  AGENCY_GRAPH_ROOT.endField,
);

export type AgencyGraphRecord = {
  kind: string;
  id: string;
  values: Record<string, unknown>;
};

export function graphKey(
  record: Pick<AgencyGraphRecord, "kind" | "id">,
): string {
  return `${record.kind}:${record.id}`;
}

export function overlayAgencyGraph(
  existing: readonly AgencyGraphRecord[],
  incoming: readonly AgencyGraphRecord[],
): Map<string, AgencyGraphRecord> {
  const records = new Map(existing.map((record) => [graphKey(record), record]));
  for (const record of incoming) {
    const key = graphKey(record);
    records.set(key, {
      ...record,
      values: { ...records.get(key)?.values, ...record.values },
    });
  }
  return records;
}

/** Pure selection over the effective graph. Shared reference kinds are independent. */
export function selectAgencyGraph(
  existing: readonly AgencyGraphRecord[],
  incoming: readonly AgencyGraphRecord[],
  additionalAgencyRootIds: readonly string[] = [],
): Set<string> {
  const records = overlayAgencyGraph(existing, incoming);
  const byKind = new Map<string, AgencyGraphRecord[]>();
  const selected = new Set<string>();
  const queue: string[] = [];
  const include = (key: string) => {
    if (!records.has(key) || selected.has(key)) return;
    selected.add(key);
    queue.push(key);
  };
  for (const [key, record] of records) {
    const group = byKind.get(record.kind) ?? [];
    group.push(record);
    byKind.set(record.kind, group);
    if (!AGENCY_GRAPH_COLUMNS.has(record.kind)) include(key);
  }
  const adjacency = new Map<string, string[]>();
  for (const edge of AGENCY_GRAPH_EDGES) {
    for (const record of byKind.get(edge[edge.holder]) ?? []) {
      const reference = record.values[edge.field];
      if (typeof reference !== "string") continue;
      const parent = edge.holder === "parent" ? record.id : reference;
      const child = edge.holder === "child" ? record.id : reference;
      const key = graphKey({ kind: edge.parent, id: parent });
      const children = adjacency.get(key) ?? [];
      children.push(graphKey({ kind: edge.child, id: child }));
      adjacency.set(key, children);
    }
  }
  // Admission uses both snapshots; traversal uses only the effective edges.
  // The dataset ending an agency's last open assignment still includes that agency.
  for (const snapshot of [overlayAgencyGraph(existing, []), records]) {
    for (const record of snapshot.values()) {
      if (record.kind === AGENCY_GRAPH_ROOT.assignmentKind) {
        const agencyId = record.values[AGENCY_GRAPH_ROOT.agencyField];
        if (
          record.values[AGENCY_GRAPH_ROOT.endField] === null &&
          typeof agencyId === "string"
        )
          include(graphKey({ kind: AGENCY_GRAPH_ROOT.kind, id: agencyId }));
      }
      if (record.kind !== AGENCY_CASE_ROOT.linkKind) continue;
      const assignmentId = record.values[AGENCY_CASE_ROOT.assignmentField];
      const caseId = record.values[AGENCY_CASE_ROOT.caseField];
      if (typeof assignmentId !== "string" || typeof caseId !== "string")
        continue;
      if (
        !snapshot.has(graphKey({ kind: AGENCY_CASE_ROOT.caseKind, id: caseId }))
      )
        continue;
      const assignment = snapshot.get(
        graphKey({ kind: AGENCY_GRAPH_ROOT.assignmentKind, id: assignmentId }),
      );
      const agencyId = assignment?.values[AGENCY_GRAPH_ROOT.agencyField];
      if (typeof agencyId === "string")
        include(graphKey({ kind: AGENCY_GRAPH_ROOT.kind, id: agencyId }));
    }
  }
  for (const id of additionalAgencyRootIds)
    include(graphKey({ kind: AGENCY_GRAPH_ROOT.kind, id }));
  for (let i = 0; i < queue.length; i++) {
    for (const child of adjacency.get(queue[i]!) ?? []) include(child);
  }
  // Intake never deletes records or suppresses their factual updates. Retention
  // happens after traversal so historical rows do not qualify new descendants.
  for (const record of existing) selected.add(graphKey(record));
  // A reached record must not preserve an FK to a candidate this same selection
  // deliberately rejects. Missing external references still fail in normal import.
  for (const key of selected) {
    const record = records.get(key)!;
    for (const { field, targetKind } of FK_REFERENCES[record.kind] ?? []) {
      const id = record.values[field];
      if (typeof id !== "string") continue;
      const target = graphKey({ kind: targetKind, id });
      if (records.has(target) && !selected.has(target)) {
        throw new Error(
          `Selected ${key}.${field} references unselected ${target}.`,
        );
      }
    }
  }
  return selected;
}
