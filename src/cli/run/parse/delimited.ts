export function parseDelimited(
  text: string,
  opts: { delimiter: string },
): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(opts.delimiter).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(opts.delimiter);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) row[h] = (cells[i] ?? "").trim();
    });
    return row;
  });
}
