import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/run/source-run.js";

// Scaffold (ADR 0030). When wired, acquire owns the non-deterministic half: sync
// the S3 submissions bucket to its sibling folder (SUBMISSIONS_BUCKET_DIR), then
// run the AI analysis (coherence + site-rules compliance) for each verified
// submission and cache the verdict per submission — so run reads a stable verdict
// and stays deterministic, and a human reviewer sees exactly what the gate saw.
export const acquire: SourceAcquire = async ({
  logger,
}: AcquireDeps): Promise<void> => {
  logger?.info(
    "org.policeconduct.submissions: scaffold; sync + AI analysis not yet wired (ADR 0030).",
  );
};
