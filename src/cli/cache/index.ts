import { z } from "zod";
import {
  correctionPropertySchema,
  inspectPropertyCorrection,
  setPropertyCorrection,
} from "../../shared/io/property-corrections.js";
import type { RegisterCliCommand } from "../../shared/cli/types.js";
import { INTAKE_API_VERSION } from "../../shared/io/import-types.js";
import {
  createCommandDirectory,
  intakeWorkspace,
} from "../command-directory.js";
import {
  createSourceNameToCanonicalIdLedger,
  type LedgerEntityKind,
} from "../state/source-name-to-canonical-id/index.js";
import {
  inspectResolvedProperty,
  retireManualResolvedProperty,
} from "../state/resolved-property/index.js";

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
  if (text === "null" && schema.safeParse(null).success) return null;
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
      "Inspect or correct any record property by source identity. --from replaces matching input; otherwise fills absent/null input.",
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
          "--from <existing-value>",
          "replace only this exact typed input value; default: absent/null",
        )
        .option(
          "--force",
          "overwrite an existing cache value, retaining its history",
        )
        .addHelpText(
          "after",
          "\nOne active manual rule per source property. --from and no --from replace the same rule with --force; rules never chain. A nonmatching rule leaves normal source/cache/resolver behavior unchanged.\nRun data generate <namespace> to use record corrections. Corrections apply before dependent property resolution; transforms do not read corrections.\n",
        );
    command.action(
      async (
        namespace: string,
        kind: string,
        sourceId: string,
        property: string,
        valueOrOptions: string | object,
        options?: { force?: boolean; from?: string },
      ) => {
        try {
          const schema = correctionPropertySchema(kind, property);
          const rootDir = intakeWorkspace(process.env);
          const ledger = createSourceNameToCanonicalIdLedger({ rootDir });
          const id = await ledger.read(
            namespace,
            kind as LedgerEntityKind,
            sourceId,
          );
          const correction = await inspectPropertyCorrection(
            rootDir,
            namespace,
            kind,
            sourceId,
            property,
          );
          const conditional =
            action === "set" || correction !== undefined || id === undefined;
          if (conditional) {
            if (action === "set") {
              const value = parseValue(schema, String(valueOrOptions));
              let from: unknown = null;
              if (options?.from !== undefined && options.from !== "null") {
                if (schema.safeParse(options.from).success) from = options.from;
                else {
                  try {
                    from = JSON.parse(options.from);
                  } catch {
                    from = options.from;
                  }
                }
              }
              // Preserve the existing explicit-overwrite protection even when switching
              // a resolved property from an unconditional value to an input condition.
              const resolved =
                id === undefined
                  ? undefined
                  : await inspectResolvedProperty({
                      rootDir,
                      subject: {
                        apiVersion: INTAKE_API_VERSION,
                        kind,
                        name: id,
                      },
                      targetProperty: property,
                    });
              if (resolved !== undefined && !options?.force)
                throw new Error(
                  `Cache already has a value. Use --force to overwrite. Current cache:\n${JSON.stringify(resolved.spec, null, 2)}`,
                );
              const { commandName } = await createCommandDirectory(
                process.env,
                {
                  args: [
                    "cache",
                    "set",
                    namespace,
                    kind,
                    sourceId,
                    property,
                    String(valueOrOptions),
                    ...(options?.from === undefined
                      ? []
                      : ["--from", options.from]),
                    ...(options?.force ? ["--force"] : []),
                  ],
                },
              );
              await setPropertyCorrection({
                rootDir,
                namespace,
                kind,
                sourceId,
                property,
                value,
                from,
                commandId: commandName,
                force: options?.force === true,
              });
              if (id !== undefined)
                await retireManualResolvedProperty({
                  rootDir,
                  subject: { apiVersion: INTAKE_API_VERSION, kind, name: id },
                  targetProperty: property,
                });
            }
            const current = await inspectPropertyCorrection(
              rootDir,
              namespace,
              kind,
              sourceId,
              property,
            );
            if (current === undefined)
              throw new Error(
                `No cached value for ${namespace}/${kind}/${sourceId}.${property}.`,
              );
            dependencies.setResult({
              exitCode: 0,
              stdout: `${JSON.stringify(current.spec, null, 2)}\n`,
            });
            return;
          }
          const input = {
            rootDir,
            subject: {
              apiVersion: INTAKE_API_VERSION,
              kind,
              name: id!,
            } as const,
            targetProperty: property,
          };
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
