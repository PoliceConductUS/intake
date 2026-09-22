import { z } from "zod";
import type { RegisterCliCommand } from "../../shared/cli/types.js";
import * as entitySpecs from "../../shared/io/generated/entity-specs.js";
import { INTAKE_API_VERSION } from "../../shared/io/import-types.js";
import { intakeWorkspace } from "../command-directory.js";
import {
  createSourceNameToCanonicalIdLedger,
  type LedgerEntityKind,
} from "../state/source-name-to-canonical-id/index.js";
import {
  inspectResolvedProperty,
  setManualResolvedProperty,
} from "../state/resolved-property/index.js";

function propertySchema(kind: string, property: string): z.ZodType {
  const spec = (entitySpecs as Record<string, unknown>)[`${kind}Spec`];
  if (
    !(spec instanceof z.ZodObject) ||
    property === "id" ||
    !entitySpecs.RESOLVED_PROPERTIES[kind]?.includes(property)
  ) {
    throw new Error(`Not a resolved cache property: ${kind}.${property}`);
  }
  const field = spec.shape[property];
  if (!(field instanceof z.ZodType))
    throw new Error(`Unknown property ${kind}.${property}`);
  return field;
}

function valueError(error: z.ZodError): Error {
  return new Error(
    error.issues
      .map((issue) => {
        if (issue.code !== "invalid_type") return issue.message;
        const article = /^[aeiou]/.test(issue.expected) ? "an" : "a";
        return `Value must be ${article} ${issue.expected}.`;
      })
      .join("; "),
  );
}

function parseValue(schema: z.ZodType, text: string): unknown {
  const direct = schema.safeParse(text);
  if (direct.success) return direct.data;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw valueError(direct.error);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw valueError(parsed.error);
  return parsed.data;
}

export const registerCliCommand: RegisterCliCommand = (
  program,
  dependencies,
) => {
  const cache = program
    .command("cache")
    .description(
      "Inspect or manually correct resolved properties by source identity.",
    );
  for (const action of ["get", "set"] as const) {
    const command = cache
      .command(action)
      .argument("<namespace>")
      .argument("<kind>")
      .argument("<source-id>")
      .argument("<property>");
    if (action === "set")
      command
        .argument("<value>")
        .option(
          "--force",
          "overwrite an existing cache value, retaining its history",
        );
    command.action(
      async (
        namespace: string,
        kind: string,
        sourceId: string,
        property: string,
        valueOrOptions: string | object,
        options?: { force?: boolean },
      ) => {
        try {
          const schema = propertySchema(kind, property);
          const rootDir = intakeWorkspace(process.env);
          const ledger = createSourceNameToCanonicalIdLedger({ rootDir });
          const id = await ledger.read(
            namespace,
            kind as LedgerEntityKind,
            sourceId,
          );
          if (id === undefined)
            throw new Error(
              `No canonical mapping for ${namespace}/${kind}/${sourceId}.`,
            );
          const input = {
            rootDir,
            subject: {
              apiVersion: INTAKE_API_VERSION,
              kind,
              name: id,
            } as const,
            targetProperty: property,
          };
          if (action === "set") {
            await setManualResolvedProperty({
              ...input,
              value: parseValue(schema, String(valueOrOptions)),
              source: { namespace, kind, name: sourceId },
              force: options?.force === true,
            });
          }
          const current = await inspectResolvedProperty(input);
          if (current === undefined)
            throw new Error(
              `No cached value for ${namespace}/${kind}/${sourceId}.${property}.`,
            );
          dependencies.setResult({
            exitCode: 0,
            stdout: `${JSON.stringify(current.spec, null, 2)}\n`,
          });
        } catch (error) {
          dependencies.setResult({
            exitCode: 1,
            stderr: `${error instanceof Error ? error.message : String(error)}\n`,
          });
        }
      },
    );
  }
};
