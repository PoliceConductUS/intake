import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const seedSql = readFileSync("supabase/seed.sql", "utf8");

function splitTopLevelList(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === "'" && inString && next === "'") {
      current += "''";
      index += 1;
      continue;
    }

    if (char === "'") {
      inString = !inString;
      current += char;
      continue;
    }

    if (!inString && char === "(") {
      depth += 1;
    }

    if (!inString && char === ")") {
      depth -= 1;
    }

    if (!inString && depth === 0 && char === ",") {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }

  return parts;
}

function extractRows(valuesSql: string): string[][] {
  return splitTopLevelList(valuesSql)
    .filter((row) => row.startsWith("(") && row.endsWith(")"))
    .map((row) => splitTopLevelList(row.slice(1, -1)));
}

function parseSqlString(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) {
    return null;
  }

  return trimmed.slice(1, -1).replaceAll("''", "'");
}

function extractInsertedColumnValues(
  tableName: string,
  columnName: string,
): string[] {
  const values: string[] = [];
  const insertPattern = new RegExp(
    `INSERT INTO public\\.${tableName}\\s*\\(([^)]*)\\)\\s*VALUES\\s*([\\s\\S]*?);`,
    "gi",
  );

  for (const match of seedSql.matchAll(insertPattern)) {
    const columns = match[1].split(",").map((column) => column.trim());
    const columnIndex = columns.indexOf(columnName);

    if (columnIndex === -1) {
      continue;
    }

    for (const row of extractRows(match[2])) {
      const parsed = parseSqlString(row[columnIndex] ?? "");

      if (parsed !== null) {
        values.push(parsed);
      }
    }
  }

  return values;
}

function isAllCapsPhrase(value: string): boolean {
  const letters = value.replace(/[^A-Za-z ]/g, "");
  const words = letters.split(/\s+/).filter((word) => word.length >= 2);

  return words.length >= 2 && /[A-Z]/.test(value) && !/[a-z]/.test(value);
}

function isPreservedNameToken(value: string): boolean {
  return ["II", "III", "IV", "VI", "VII", "VIII", "IX"].includes(value);
}

function hasUnpreservedAllCapsWords(value: string): boolean {
  const preservedTokens = new Set([
    "A&M",
    "A",
    "ATF",
    "ATTY.'s",
    "CBP",
    "CISD",
    "C.I.S.D.",
    "CO.",
    "CSCD",
    "D.P.S.",
    "D.",
    "DART",
    "DEA",
    "DFW",
    "DIST.",
    "DPS",
    "EMS",
    "FBI",
    "H&S",
    "ICE",
    "I.S.D.",
    "ISD",
    "L.C.R.A.",
    "M",
    "P.",
    "P.D.",
    "S.",
    "TDCJ",
    "TSA",
    "U.",
    "U.S.",
    "USCG",
    "USSS",
  ]);

  return value
    .split(/\s+/)
    .some(
      (word) => /^[A-Z][A-Z'.-]*$/.test(word) && !preservedTokens.has(word),
    );
}

describe("seed display text", () => {
  test("stores agency names in readable display casing", () => {
    const agencyNames = [
      ...extractInsertedColumnValues("agency", "name"),
      ...extractInsertedColumnValues("federal_agency", "name"),
    ];
    const shoutingNames = agencyNames.filter((name) => {
      return isAllCapsPhrase(name) || hasUnpreservedAllCapsWords(name);
    });

    expect(shoutingNames).toEqual([]);
  });

  test("stores officer names and license types in readable display casing", () => {
    const officerDisplayValues = [
      ...extractInsertedColumnValues("officers", "first_name"),
      ...extractInsertedColumnValues("officers", "last_name"),
      ...extractInsertedColumnValues("officers", "middle_name"),
      ...extractInsertedColumnValues("agency_officers", "title"),
    ];
    const shoutingValues = officerDisplayValues.filter((value) => {
      return (
        /[A-Z]{2,}/.test(value) &&
        !/[a-z]/.test(value) &&
        !isPreservedNameToken(value)
      );
    });

    expect(shoutingValues).toEqual([]);
  });
});
