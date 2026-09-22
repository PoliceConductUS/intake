/** A shared resolution can require several properties to be supplied together. */
export class UnresolvedPropertiesError extends Error {
  constructor(
    message: string,
    readonly properties: readonly string[],
  ) {
    super(message);
  }
}

function shellArgument(value: string): string {
  return /^[a-zA-Z0-9_./:-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

/** Marks an error already attributed to the property that actually failed. */
export class CacheCorrectionError extends Error {
  constructor(
    cause: unknown,
    input: {
      namespace: string;
      kind: string;
      sourceId: string;
      canonicalId: string;
      properties: readonly string[];
      cacheDiagnostics?: readonly string[];
    },
  ) {
    const identity = [input.namespace, input.kind, input.sourceId]
      .map(shellArgument)
      .join(" ");
    const commands = input.properties.flatMap((property) => [
      `npm run cli -- cache get ${identity} ${shellArgument(property)}`,
      `npm run cli -- cache set ${identity} ${shellArgument(property)} 'REPLACE_WITH_VERIFIED_VALUE'`,
    ]);
    super(
      [
        cause instanceof Error ? cause.message : String(cause),
        `Cache correction: namespace=${JSON.stringify(input.namespace)} kind=${input.kind} source-id=${JSON.stringify(input.sourceId)} canonical-id=${input.canonicalId}; properties=${input.properties.join(", ")}.`,
        ...(input.cacheDiagnostics ?? []),
        "Inspect the current cache and replace each value placeholder with a verified value:",
        ...commands,
        "If set reports an existing value, review it and add --force to replace it.",
      ].join("\n"),
      { cause },
    );
  }
}
