import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/run/source-run.js";

const run = promisify(execFile);

// acquire owns the non-deterministic half (ADR 0030): mirror the S3 submissions
// bucket to its local folder so `run` reads a stable snapshot, and push any local
// changes (curation status verdicts under submissions/status/) back to S3. The
// publication gate is human-set for now — statuses live in the bucket — so acquire
// only syncs; when the AI gate is wired it runs here and caches its verdict too.
async function s3Sync(
  from: string,
  to: string,
  profile: string | undefined,
  { mirror }: { mirror: boolean },
): Promise<void> {
  // `--delete` only on the DOWN mirror (local reflects S3). The UP sync is additive
  // — never `--delete` — so an incomplete local mirror can never delete a real
  // submission from S3.
  const args = ["s3", "sync", from, to];
  if (mirror) {
    args.push("--delete");
  }
  if (profile !== undefined && profile.trim() !== "") {
    args.push("--profile", profile);
  }
  await run("aws", args);
}

export const acquire: SourceAcquire = async ({
  env,
  logger,
}: AcquireDeps): Promise<void> => {
  const bucketDir = env.SUBMISSIONS_BUCKET_DIR;
  const s3Bucket = env.SUBMISSIONS_S3_BUCKET;
  if (bucketDir === undefined || bucketDir.trim() === "") {
    throw new Error(
      "org.policeconduct.submissions: SUBMISSIONS_BUCKET_DIR is required (the local synced bucket folder).",
    );
  }
  if (s3Bucket === undefined || s3Bucket.trim() === "") {
    throw new Error(
      "org.policeconduct.submissions: SUBMISSIONS_S3_BUCKET is required (s3://... source bucket).",
    );
  }
  const profile = env.AWS_PROFILE;

  logger?.info(`org.policeconduct.submissions: syncing ${s3Bucket} → local.`);
  await s3Sync(s3Bucket, bucketDir, profile, { mirror: true });
  logger?.info(
    `org.policeconduct.submissions: syncing local status changes → ${s3Bucket}.`,
  );
  await s3Sync(bucketDir, s3Bucket, profile, { mirror: false });
};
