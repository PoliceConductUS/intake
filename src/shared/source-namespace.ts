export const sourceNamespacePattern =
  /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;

export function assertValidSourceId(sourceId: string): void {
  if (!sourceNamespacePattern.test(sourceId)) {
    throw new Error(`Invalid source id: ${sourceId}`);
  }
}
