import { Artifacts } from "../../shared/io/index.js";
import type {
  ArtifactsEnvelope,
  ImportArtifactKind,
} from "../../shared/io/index.js";
import type { EmitRefItem } from "./emit-sink.js";
import type { readXlsx } from "./read-xlsx.js";

export type EmittedRecords = Record<string, { spec: unknown }>;
export type SourceManifest = {
  artifacts: Array<{ kind: ImportArtifactKind; records: EmittedRecords }>;
};
export type ResolvedPersonnel = { agencyPersonnelId: string };
// CivilCase identity is its natural key (court:docket, ADR 0028), so a resolved
// civil case is that key directly — no ledger mapping.
export type ResolvedCivilCase = { civilCaseId: string };

// An intake-owned resolver injected into a source's run phase (ADR 0023). The
// source calls it with source ids only; match, gate, and mint happen inside, and
// it returns a namespace-local personnel source id or null — a canonical id never
// crosses the boundary.
export type RunDataContext = {
  resolvePersonnel(input: {
    agencyId: string;
    personnelName: string;
  }): Promise<ResolvedPersonnel | null>;
  // Resolve a docket to an EXISTING civil case's natural key, or null. Optional:
  // sources that never reference cases do not need it.
  resolveCivilCase?(input: {
    docket: string;
  }): Promise<ResolvedCivilCase | null>;
};

export type RunDeps = {
  paths: string[];
  readXlsx: typeof readXlsx;
  state: string;
  emit: (kind: string, key: string, spec: unknown) => Promise<void>;
  env?: Record<string, string | undefined>;
  data?: RunDataContext;
  logger?: { info: (message: string) => void };
};
export type SourceRun = (deps: RunDeps) => Promise<SourceManifest>;

// The optional acquire phase: a source downloads/scrapes its raw inputs into
// `sourceDir` (preserving the original format — html/csv/json, no transforms),
// so the deterministic `run` (produce) phase can then read them. Network and
// non-determinism live here, never in `run`.
// The acquire context returns only the smallest set of fields a source needs
// today, and never a canonical id or foreign key (ADR 0023/0015): a source id
// stands in for the agency's identity, name and location context drive the
// source's own queries.
export type AcquireAgencyRecord = {
  agencyId: string;
  name: string;
  state: string;
  county: string | null;
  place: string | null;
};

export type AcquireAgencyPage = {
  items: AcquireAgencyRecord[];
  nextCursor?: string;
};

// A read-only facade over already-imported data an acquire may need to decide
// what to download (e.g. which agencies to search). Sources ask the facade;
// they never touch the database directly.
export type AcquireDataContext = {
  agencies(query: {
    states?: string[];
    minOfficers?: number;
    cursor?: string;
    limit?: number;
  }): Promise<AcquireAgencyPage>;
};

export type AcquireDeps = {
  sourceDir: string;
  state: string;
  env: Record<string, string | undefined>;
  data: AcquireDataContext;
  logger?: { info: (message: string) => void };
};
export type SourceAcquire = (deps: AcquireDeps) => Promise<void>;

export function buildArtifactsEnvelope(
  sourceId: string,
  digest: string,
  manifest: SourceManifest,
  refItems: EmitRefItem[] = [],
): ArtifactsEnvelope {
  return Artifacts.new({
    metadata: { name: `${sourceId}-${digest}`, namespace: sourceId },
    spec: {
      artifacts: [
        ...manifest.artifacts.map((artifact) => ({
          kind: artifact.kind,
          spec: { records: artifact.records },
        })),
        ...refItems,
      ],
    },
  }) as ArtifactsEnvelope;
}
