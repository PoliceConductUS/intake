import {
  defaultDatabaseClientFactory,
  type DatabaseClient,
} from "../database/index.js";
import { readLocationPathById } from "../database/location-paths.js";
import { z } from "zod";
import { RECORD_KINDS_IN_DEPENDENCY_ORDER } from "../../shared/io/generated/entity-specs.js";
import { SourceNameToCanonicalId } from "../state/source-name-to-canonical-id/SourceNameToCanonicalId.js";
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
  // Set supplies a present value. Optional/null states belong to unset, and
  // string fields receive the command-line text without JSON interpretation.
  let valueSchema = schema;
  while (
    valueSchema instanceof z.ZodNullable ||
    valueSchema instanceof z.ZodOptional
  )
    valueSchema = valueSchema.unwrap() as z.ZodType;
  const direct = valueSchema.safeParse(text);
  if (direct.success) return direct.data;
  if (valueSchema instanceof z.ZodString) throw valueError(direct.error);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw valueError(direct.error);
  }
  const parsed = valueSchema.safeParse(value);
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
  cache
    .command("alias")
    .description(
      "Map a new source name to an existing canonical identity, retaining the old name.",
    )
    .argument("<namespace>")
    .argument("<kind>")
    .argument("<new-source-id>")
    .argument("<existing-source-id>")
    .requiredOption(
      "--evidence <reference>",
      "reference to the evidence establishing identical identity",
    )
    .addHelpText(
      "after",
      "\nA new alias becomes the preferred reverse source name. Replaying an existing matching alias leaves the current reverse name unchanged. No database rows change.\n",
    )
    .action(
      async (
        namespace: string,
        kind: string,
        newSourceId: string,
        existingSourceId: string,
        options: { evidence: string },
      ) => {
        try {
          const nonEmpty = z.string().trim().min(1);
          namespace = nonEmpty.parse(namespace);
          kind = z.enum(RECORD_KINDS_IN_DEPENDENCY_ORDER).parse(kind);
          newSourceId = nonEmpty.parse(newSourceId);
          existingSourceId = nonEmpty.parse(existingSourceId);
          const evidence = nonEmpty.parse(options.evidence);
          const ledger = createSourceNameToCanonicalIdLedger({
            rootDir: intakeWorkspace(process.env),
          });
          const entityKind = kind as LedgerEntityKind;
          const canonicalId = await ledger.read(
            namespace,
            entityKind,
            existingSourceId,
          );
          if (canonicalId === undefined)
            throw new Error(
              `Existing source mapping is missing: ${namespace}/${kind}/${existingSourceId}.`,
            );
          const existingAliasId = await ledger.read(
            namespace,
            entityKind,
            newSourceId,
          );
          if (existingAliasId !== undefined && existingAliasId !== canonicalId)
            throw new Error(
              `Source ${namespace}/${kind}/${newSourceId} already maps to ${existingAliasId}, not ${canonicalId}.`,
            );
          const reverseSourceName =
            existingAliasId === undefined
              ? newSourceId
              : await ledger.readSourceName(namespace, entityKind, canonicalId);
          if (reverseSourceName === undefined)
            throw new Error(
              `Reverse source mapping is missing: ${namespace}/${kind}/${canonicalId}.`,
            );
          const { commandName, outputDirectory } = await createCommandDirectory(
            process.env,
            {
              args: [
                "cache",
                "alias",
                namespace,
                kind,
                newSourceId,
                existingSourceId,
                "--evidence",
                evidence,
              ],
            },
          );
          const provenance = await SourceNameToCanonicalId.write(
            outputDirectory,
            SourceNameToCanonicalId.new({
              metadata: {
                name: newSourceId,
                namespace,
                annotations: {
                  operation: "identity-alias",
                  existingSourceName: existingSourceId,
                  evidence,
                  commandId: commandName,
                  reverseSourceName,
                },
              },
              spec: { kind, canonicalId },
            }),
          );
          const resolved = await ledger.findOrCreate(
            namespace,
            entityKind,
            newSourceId,
            async () => canonicalId,
          );
          if (resolved !== canonicalId)
            throw new Error(
              `Alias resolved to conflicting canonical ID ${resolved}.`,
            );
          dependencies.setResult({
            exitCode: 0,
            stdout: `${JSON.stringify({ canonicalId, reverseSourceName, provenancePath: provenance.path }, null, 2)}\n`,
          });
        } catch (error) {
          dependencies.setResult({
            exitCode: 1,
            stderr: `${error instanceof Error ? error.message : String(error)}\n`,
          });
        }
      },
    );
  for (const action of ["get", "set", "unset"] as const) {
    const command = cache
      .command(action)
      .argument("<namespace>")
      .argument("<kind>")
      .argument("<source-id>")
      .argument("<property>");
    if (action === "set") command.argument("<value>");
    if (action !== "get")
      command
        .requiredOption(
          "--message <message>",
          "explain the correction (at least 10 characters)",
        )
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
          "\nSet stores a value; the text null is not a clearing instruction. Unset explicitly clears a nullable field. One active manual rule per source property. --from and no --from replace the same rule with --force; rules never chain. A nonmatching rule leaves normal source/cache/resolver behavior unchanged.\nRun data generate <namespace> to use record corrections. Corrections apply before dependent property resolution; transforms do not read corrections.\n",
        );
    command.action(
      async (
        namespace: string,
        kind: string,
        sourceId: string,
        property: string,
        valueOrOptions: string | object,
        options?: { force?: boolean; from?: string; message?: string },
      ) => {
        if (action === "unset")
          options = valueOrOptions as {
            force?: boolean;
            from?: string;
            message?: string;
          };
        let locationClient: DatabaseClient | undefined;
        const getLocationPathById = async (id: string) => {
          if (locationClient === undefined) {
            const url = process.env.DATABASE_URL;
            if (!url)
              throw new Error(
                "DATABASE_URL is required to verify an agency location is a place.",
              );
            locationClient = defaultDatabaseClientFactory(url);
            await locationClient.connect();
          }
          return readLocationPathById(locationClient, id);
        };
        try {
          const schema = correctionPropertySchema(kind, property);
          if (action !== "get")
            options!.message = z
              .string()
              .trim()
              .min(10, "Message must contain at least 10 characters.")
              .parse(options?.message);
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
            getLocationPathById,
          );
          const conditional =
            action !== "get" || correction !== undefined || id === undefined;
          if (conditional) {
            if (action !== "get") {
              const value =
                action === "unset"
                  ? schema.parse(null)
                  : parseValue(schema, String(valueOrOptions));
              let from: unknown = null;
              if (options?.from !== undefined) {
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
                      getLocationPathById,
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
                    action,
                    namespace,
                    kind,
                    sourceId,
                    property,
                    ...(action === "set" ? [String(valueOrOptions)] : []),
                    ...(options?.from === undefined
                      ? []
                      : ["--from", options.from]),
                    ...(options?.force ? ["--force"] : []),
                    "--message",
                    options!.message!,
                  ],
                },
              );
              await setPropertyCorrection({
                getLocationPathById,
                rootDir,
                namespace,
                kind,
                sourceId,
                property,
                ...(action === "unset"
                  ? { operation: "unset" as const }
                  : { value }),
                from,
                commandId: commandName,
                force: options?.force === true,
                message: options!.message!,
              });
              if (id !== undefined)
                await retireManualResolvedProperty({
                  rootDir,
                  subject: { apiVersion: INTAKE_API_VERSION, kind, name: id },
                  targetProperty: property,
                  getLocationPathById,
                });
            }
            const current = await inspectPropertyCorrection(
              rootDir,
              namespace,
              kind,
              sourceId,
              property,
              getLocationPathById,
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
            getLocationPathById,
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
        } finally {
          await locationClient?.end();
        }
      },
    );
  }
};
