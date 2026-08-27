import { createInterface, type Interface } from "node:readline/promises";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/run/source-run.js";
import { appendEntry } from "./chain.js";
import { describeKind, parseRecord } from "./entity-model.js";
import { HANDLED_RECORD_KINDS } from "./kinds.js";

async function interview(
  rl: Interface,
): Promise<{ kind: string; record: Record<string, unknown> }> {
  const kind = (
    await rl.question(`Kind (${HANDLED_RECORD_KINDS.join(", ")}): `)
  ).trim();
  const model = describeKind(kind);
  const record: Record<string, unknown> = {};
  for (const field of model.fields) {
    // A foreign key is entered as its target's source id. For a LocationPath that
    // is its path (e.g. /mn/ramsey-county/saint-paul/); import resolves by path.
    const label = field.targetKind
      ? `${field.name} [${field.targetKind} source id]`
      : field.name;
    const suffix = field.optional ? " (optional, blank to skip)" : "";
    const value = (await rl.question(`${label}${suffix}: `)).trim();
    if (value !== "") {
      record[field.name] = value;
    }
  }
  return { kind, record };
}

// A type-independent, model-driven curation source (ADR 0031). acquire interviews
// a human to create a record of a chosen kind — the fields come from the shared
// record model (`<Kind>Spec` + FK targets), never hand-coded — and appends it to a
// sha-chained output. run emits the records as artifacts; import resolves their
// FKs and identity as usual. LocationPathAlias is the first handled kind.
export const acquire: SourceAcquire = async ({
  state,
  env,
  logger,
}: AcquireDeps): Promise<void> => {
  let kind: string;
  let record: Record<string, unknown>;
  if (env.MANUAL_KIND !== undefined && env.MANUAL_RECORD !== undefined) {
    kind = env.MANUAL_KIND;
    record = JSON.parse(env.MANUAL_RECORD) as Record<string, unknown>;
  } else {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      ({ kind, record } = await interview(rl));
    } finally {
      rl.close();
    }
  }

  if (!(HANDLED_RECORD_KINDS as readonly string[]).includes(kind)) {
    throw new Error(
      `org.policeconduct.manual: kind ${kind} is not handled (${HANDLED_RECORD_KINDS.join(", ")}).`,
    );
  }
  const model = describeKind(kind);
  const validated = parseRecord(kind, record);
  const output = await appendEntry(
    state,
    { kind, record: validated },
    model.identity,
  );
  logger?.info(
    `org.policeconduct.manual: recorded ${kind} (${output.entries.length} curated record(s) total).`,
  );
};
