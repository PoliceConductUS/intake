import type { SourceRun } from "../../src/cli/run/source-run.js";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";

// DISABLED for now — no-op. The AZ POST roster only yields bare Personnel with no
// agency link, which resolves to nothing useful (everything must resolve to an
// officer@agency). The workbook DOES carry what's needed to fix this — an AGENCY
// column plus APPOINTED ON / TERMINATED ON dates, one row per person-per-agency —
// so re-enable this source by emitting AgencyPersonnel (personnel_id ← POST ID,
// agency_id ← AGENCY, start_date ← APPOINTED ON, end_date ← TERMINATED ON) and the
// Agency records those reference, alongside Personnel.
export const produces: readonly ImportArtifactKind[] = [];

export const description =
  "Arizona POST roster — disabled (produces no agency-linked personnel yet).";

export const run: SourceRun = async () => ({ artifacts: [] });
