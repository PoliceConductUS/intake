import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/transform/source-transform.js";

const run = promisify(execFile);

// acquire owns the non-deterministic half (ADR 0030): pull the S3 submissions
// bucket to its local folder so `run` reads a stable snapshot, and push any local
// curator changes (status verdicts, curator-authored submissions) back up. Both
// directions are additive (never `--delete`): the bucket holds locally-authored
// content that cannot always round-trip (the write-back principal may be
// read-only), so a --delete mirror would erase it. New S3 submissions still
// arrive; a submission deleted directly in S3 is not pruned locally.
async function s3Sync(
  from: string,
  to: string,
  profile: string | undefined,
): Promise<void> {
  const args = ["s3", "sync", from, to, "--exclude", "*.DS_Store"];
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

  // The write-back is best-effort: the bucket policy may deny PutObject to this
  // principal (submissions are written only by the website pipeline). A denied or
  // failed up-sync is warned and skipped — never fatal — so a read-only profile
  // still acquires. Curator changes then stay local until a writable principal
  // pushes them.
  logger?.info(
    `org.policeconduct.submissions: pushing local changes → ${s3Bucket} (best-effort).`,
  );
  try {
    await s3Sync(bucketDir, s3Bucket, profile);
  } catch (error) {
    logger?.info(
      `org.policeconduct.submissions: WARNING — write-back skipped (${
        error instanceof Error ? error.message.split("\n")[0] : String(error)
      }).`,
    );
  }

  logger?.info(`org.policeconduct.submissions: pulling ${s3Bucket} → local.`);
  await s3Sync(s3Bucket, bucketDir, profile);
};
