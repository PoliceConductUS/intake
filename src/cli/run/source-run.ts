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
export type RunDeps = {
  paths: string[];
  readXlsx: typeof readXlsx;
  state: string;
  emit: (kind: string, key: string, spec: unknown) => Promise<void>;
  env?: Record<string, string | undefined>;
  logger?: { info: (message: string) => void };
};
export type SourceRun = (deps: RunDeps) => Promise<SourceManifest>;

// The optional acquire phase: a source downloads/scrapes its raw inputs into
// `sourceDir` (preserving the original format — html/csv/json, no transforms),
// so the deterministic `run` (produce) phase can then read them. Network and
// non-determinism live here, never in `run`.
export type AcquireAgencyRecord = {
  state: string;
  county: string | null;
  place: string | null;
  agency: Record<string, unknown>;
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
