export type InputAccounting = {
  input: string;
  read: number;
  emitted: number;
  reported: number;
  notSelected: Record<string, number>;
};

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

export function accountingTotals(
  sourceId: string,
  accounting: unknown,
): string {
  if (!Array.isArray(accounting))
    throw new Error(`Source ${sourceId} did not state its row accounting.`);
  const lines = accounting.map((entry: InputAccounting) => {
    if (typeof entry?.input !== "string" || !entry.input.trim())
      throw new Error(`Source ${sourceId} row accounting names no input.`);
    const notSelected = Object.entries(entry.notSelected ?? {});
    for (const [name, count] of [
      ["read", entry.read],
      ["emitted", entry.emitted],
      ["reported", entry.reported],
      ...notSelected.map(([reason, count]) => [
        `not selected (${reason})`,
        count,
      ]),
    ] as Array<[string, unknown]>)
      if (!isCount(count))
        throw new Error(
          `Source ${sourceId} row accounting for ${entry.input}: ${name} is not a count: ${String(count)}`,
        );
    const accounted =
      entry.emitted +
      entry.reported +
      notSelected.reduce((sum, [, count]) => sum + count, 0);
    if (accounted !== entry.read)
      throw new Error(
        `Source ${sourceId} row accounting for ${entry.input}: read ${entry.read}, accounted for ${accounted}, difference ${entry.read - accounted}.`,
      );
    return `${entry.input}: read ${entry.read}, emitted ${entry.emitted}, reported ${entry.reported}, not selected ${accounted - entry.emitted - entry.reported}${notSelected.length > 0 ? ` (${notSelected.map(([reason, count]) => `${reason}=${count}`).join(", ")})` : ""}`;
  });
  return `${sourceId}: row accounting: ${lines.length > 0 ? lines.join("; ") : "no rows"}`;
}
