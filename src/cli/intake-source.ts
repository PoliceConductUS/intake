import type { RequestDefinition } from "./requests/lifecycle.js";
import type { PortalForm } from "./requests/portal.js";
import type {
  SourceAcquire,
  SourceTransform,
} from "./transform/source-transform.js";
import type { ImportArtifactKind } from "../shared/io/import-type-metadata.js";
import type { Environment } from "./parameter-store-env.js";

interface SourceOperations {
  description?: string;
  standalone?: boolean;
  acquire?: SourceAcquire;
  request?: RequestDefinition;
  portalForm?: PortalForm;
  daily?: (env: Environment) => Promise<void>;
}

/** The public contract exported by each intake.source.ts module. */
export type IntakeSource = SourceOperations &
  (
    | { transform: SourceTransform; produces: readonly ImportArtifactKind[] }
    | { transform?: never; produces?: never }
  );
