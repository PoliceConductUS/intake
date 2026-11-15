import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export type Stored<T> = { value: T; etag: string };
export interface NewsStorage {
  readJson<T>(key: string): Promise<Stored<T> | null>;
  writeJson(
    key: string,
    value: unknown,
    previousEtag: string | null,
  ): Promise<boolean>;
  readOriginal(releaseId: string, path: string): Promise<string>;
  readOverrideEtag(releaseId: string, path: string): Promise<string | null>;
  writeOverride(
    releaseId: string,
    path: string,
    html: string,
    previousEtag: string | null,
  ): Promise<boolean>;
  makeVisible(releaseId: string, path: string): Promise<void>;
}
export function pageKey(
  id: string,
  folder: "static" | "override" | "data",
  path: string,
) {
  if (
    !/^[a-z0-9-]+$/.test(id) ||
    !path.startsWith("/") ||
    !path.endsWith("/") ||
    new URL(path, "https://local.invalid").pathname !== path ||
    path.startsWith("//") ||
    /[?#\\]/.test(path)
  )
    throw new Error("Invalid release or canonical page path");
  return `builds/${id}/${folder}${path}index.${folder === "data" ? "json" : "html"}`;
}
const run = promisify(execFile);
async function aws(args: string[]) {
  const { stdout } = await run(
    "aws",
    [...args, "--output", "json", "--no-cli-pager"],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout.trim() ? JSON.parse(stdout) : {};
}
async function withFile<T>(callback: (path: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "news-storage-"));
  try {
    return await callback(join(dir, "body"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
function awsError(error: unknown, codes: string[]) {
  const stderr = (error as { stderr?: string }).stderr ?? "";
  return codes.some((code) => stderr.includes("(" + code + ")"));
}
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error("Missing " + name);
  return value;
}
export function createNewsStorage(): NewsStorage {
  const privateBucket = required("NEWS_PRIVATE_BUCKET"),
    siteBucket = required("NEWS_SITE_BUCKET");
  async function get(bucket: string, key: string) {
    return withFile(async (file) => {
      try {
        const meta = await aws([
          "s3api",
          "get-object",
          "--bucket",
          bucket,
          "--key",
          key,
          file,
        ]);
        return { value: await readFile(file, "utf8"), etag: String(meta.ETag) };
      } catch (error) {
        if (awsError(error, ["NoSuchKey", "404"])) return null;
        throw error;
      }
    });
  }
  async function put(
    bucket: string,
    key: string,
    value: string,
    type: string,
    etag: string | null,
  ) {
    return withFile(async (file) => {
      await writeFile(file, value);
      try {
        await aws([
          "s3api",
          "put-object",
          "--bucket",
          bucket,
          "--key",
          key,
          "--content-type",
          type,
          "--body",
          file,
          ...(etag === null ? ["--if-none-match", "*"] : ["--if-match", etag]),
        ]);
        return true;
      } catch (error) {
        if (
          awsError(error, [
            "PreconditionFailed",
            "ConditionalRequestConflict",
            "409",
            "412",
          ])
        )
          return false;
        throw error;
      }
    });
  }
  return {
    async readJson<T>(key: string) {
      const object = await get(privateBucket, key);
      return object
        ? { etag: object.etag, value: JSON.parse(object.value) as T }
        : null;
    },
    async writeJson(key, value, etag) {
      return put(
        privateBucket,
        key,
        JSON.stringify(value),
        "application/json",
        etag,
      );
    },
    async readOriginal(id, path) {
      const object = await get(siteBucket, pageKey(id, "static", path));
      if (!object) throw new Error("Missing release original: " + path);
      return object.value;
    },
    async readOverrideEtag(id, path) {
      try {
        return String(
          (
            await aws([
              "s3api",
              "head-object",
              "--bucket",
              siteBucket,
              "--key",
              pageKey(id, "override", path),
            ])
          ).ETag,
        );
      } catch (error) {
        if (awsError(error, ["404", "NotFound"])) return null;
        throw error;
      }
    },
    async writeOverride(id, path, html, etag) {
      return put(
        siteBucket,
        pageKey(id, "override", path),
        html,
        "text/html; charset=utf-8",
        etag,
      );
    },
    async makeVisible(releaseId, path) {
      const invalidationId = await withFile(async (file) => {
        const meta = await aws([
          "lambda",
          "invoke",
          "--function-name",
          required("NEWS_RELEASE_FUNCTION"),
          "--cli-binary-format",
          "raw-in-base64-out",
          "--payload",
          JSON.stringify({ operation: "publish-page", releaseId, path }),
          file,
        ]);
        const result = JSON.parse(await readFile(file, "utf8"));
        if (meta.FunctionError || typeof result.invalidationId !== "string")
          throw new Error(
            "Release publication failed: " + JSON.stringify(result),
          );
        return result.invalidationId;
      });
      await aws([
        "cloudfront",
        "wait",
        "invalidation-completed",
        "--distribution-id",
        required("NEWS_DISTRIBUTION_ID"),
        "--id",
        invalidationId,
      ]);
    },
  };
}
