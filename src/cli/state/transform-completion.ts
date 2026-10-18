import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Artifacts } from "../../shared/io/index.js";
import { readCommandPointer } from "./command-pointer.js";

const Snapshot = z.strictObject({
  directory: z.string().min(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
const Completion = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("started") }),
  z.strictObject({
    status: z.literal("complete"),
    input: Snapshot.nullable(),
    outputDigest: z.string().regex(/^[a-f0-9]{64}$/),
    artifactsPath: z.string().min(1),
  }),
]);
type Completion = z.infer<typeof Completion>;
const statePath = (state: string) =>
  path.join(state, "transform-completion.json");

/** Includes file names and bytes: adding, removing, renaming or editing input invalidates a handoff. */
export async function directoryDigest(directory: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(dir: string): Promise<void> {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) {
        hash.update(JSON.stringify(path.relative(directory, full)));
        hash.update(
          createHash("sha256")
            .update(await readFile(full))
            .digest(),
        );
      } else throw new Error(`Unsupported snapshot entry: ${full}`);
    }
  }
  await visit(directory);
  return hash.digest("hex");
}
async function writeCompletion(
  state: string,
  value: Completion,
): Promise<void> {
  await mkdir(state, { recursive: true });
  await writeFile(
    statePath(state),
    JSON.stringify(Completion.parse(value)) + "\n",
  );
}
export async function beginTransform(state: string): Promise<void> {
  await writeCompletion(state, { status: "started" });
}
export async function snapshotInput(
  workspace: string,
  state: string,
  standalone: boolean,
) {
  if (standalone) return null;
  const { latest } = await readCommandPointer(state, "acquire");
  if (latest === undefined)
    throw new Error("No completed acquisition for transform.");
  const directory = path.resolve(workspace, latest);
  return { directory, digest: await directoryDigest(directory) };
}
export async function completeTransform(
  state: string,
  artifactsPath: string,
  input: z.infer<typeof Snapshot> | null,
): Promise<void> {
  if (
    input !== null &&
    (await directoryDigest(input.directory)) !== input.digest
  )
    throw new Error("Acquired input changed during transform.");

  await writeCompletion(state, {
    status: "complete",
    input,
    artifactsPath: path.resolve(artifactsPath),
    outputDigest: await Artifacts.integrityDigest(artifactsPath),
  });
}
/** Single handoff gate shared by generation and its internal import entry point. */
export async function requireTransformCompletion(
  workspace: string,
  sourceId: string,
  artifactsPath?: string,
): Promise<string> {
  const state = path.join(workspace, "state", sourceId);
  let record: Completion;
  try {
    record = Completion.parse(
      JSON.parse(await readFile(statePath(state), "utf8")),
    );
  } catch {
    throw new Error(
      `No recorded successful transform for ${sourceId}; run intake data transform ${sourceId}.`,
    );
  }
  if (record.status !== "complete")
    throw new Error(
      `No recorded successful transform for ${sourceId}; latest attempt did not complete.`,
    );
  if (
    artifactsPath !== undefined &&
    path.resolve(artifactsPath) !== record.artifactsPath
  )
    throw new Error(
      `Artifacts do not match the successful transform for ${sourceId}.`,
    );
  if (record.input !== null) {
    const current = await snapshotInput(workspace, state, false);
    if (
      current === null ||
      current.directory !== record.input.directory ||
      current.digest !== record.input.digest
    )
      throw new Error(
        `Acquired input changed since successful transform for ${sourceId}.`,
      );
  }
  if (
    (await Artifacts.integrityDigest(record.artifactsPath)) !==
    record.outputDigest
  )
    throw new Error(
      `Artifacts changed since successful transform for ${sourceId}.`,
    );
  return record.artifactsPath;
}
