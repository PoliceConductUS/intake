import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SourceAcquire } from "../../src/cli/transform/source-transform.js";
const run = promisify(execFile);
export const acquire: SourceAcquire = async ({ sourceDir, env }) => {
  const bucket = env.NEWS_PRIVATE_BUCKET;
  if (!bucket) throw Error("NEWS_PRIVATE_BUCKET is required.");
  let release = env.NEWS_IMPORT_RELEASE;
  if (!release) {
    if (!env.NEWS_RELEASE_FUNCTION)
      throw Error(
        "NEWS_RELEASE_FUNCTION is required to select the active release.",
      );
    const file = join(sourceDir, "snapshot.json");
    const result = await run("aws", [
      "lambda",
      "invoke",
      "--function-name",
      env.NEWS_RELEASE_FUNCTION,
      "--cli-binary-format",
      "raw-in-base64-out",
      "--payload",
      JSON.stringify({ operation: "release-snapshot" }),
      file,
      "--output",
      "json",
    ]);
    if (JSON.parse(result.stdout).FunctionError)
      throw Error("Release snapshot failed.");
    const snapshot = JSON.parse(await readFile(file, "utf8"));
    if (snapshot.roster.bucket !== bucket)
      throw Error("Release snapshot points to a different private bucket.");
    release = snapshot.releaseId;
  }
  if (
    typeof release !== "string" ||
    !/^(?:builds\/)?[a-z0-9-]+(?:\/data)?\/?$/.test(release)
  )
    throw Error("Expected a release ID or its builds/<id>/data folder.");
  const id = release.replace(/^builds\//, "").replace(/\/data\/?$|\/$/, "");
  const prefix = "builds/" + id + "/data/";
  const { stdout } = await run(
    "aws",
    [
      "s3api",
      "list-objects-v2",
      "--bucket",
      bucket,
      "--prefix",
      prefix,
      "--query",
      "Contents[].Key",
      "--output",
      "json",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const keys = (JSON.parse(stdout) ?? []) as string[];
  if (!keys.includes(prefix + "index.json"))
    throw Error("Selected release has no homepage data.");
  let count = 0;
  for (const key of keys.filter((k) => k.endsWith("/index.json")).sort()) {
    const file = join(sourceDir, String(++count) + ".page.json");
    await run("aws", [
      "s3api",
      "get-object",
      "--bucket",
      bucket,
      "--key",
      key,
      file,
    ]);
    const page = JSON.parse(await readFile(file, "utf8"));
    if (page.news) {
      if (!Array.isArray(page.news.data?.articles))
        throw Error("Invalid news data at " + key);
      await writeFile(
        join(sourceDir, count + ".news.json"),
        JSON.stringify(page.news.data),
      );
    }
  }
};
