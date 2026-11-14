import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  excludedRecordKey,
  loadExcludedRecords,
  appendExcludedRecord,
} from "../../../src/shared/io/excluded-records.js";

let sourceDir: string;

beforeEach(async () => {
  sourceDir = await mkdtemp(path.join(tmpdir(), "excluded-records-"));
});

it.each([0o600, 0o660])(
  "preserves existing mode %s on append and replacement",
  async (mode) => {
    const previousMask = process.umask(0o022);
    try {
      const file = await appendExcludedRecord(sourceDir, {
        kind: "Personnel",
        key: "one",
        reason: "original",
      });
      await chmod(file, mode);
      await appendExcludedRecord(sourceDir, {
        kind: "Personnel",
        key: "two",
        reason: "another record",
      });
      expect((await stat(file)).mode & 0o7777).toBe(mode);
      await appendExcludedRecord(
        sourceDir,
        {
          kind: "Personnel",
          key: "one",
          reason: "updated",
          when: { first_name: "9" },
        },
        { replace: true },
      );
      expect((await stat(file)).mode & 0o7777).toBe(mode);
    } finally {
      process.umask(previousMask);
    }
  },
);

it("keeps the staged document private while replacing a private target", async () => {
  const previousMask = process.umask(0o022);
  try {
    const file = await appendExcludedRecord(sourceDir, {
      kind: "Personnel",
      key: "one",
      reason: "original",
    });
    await chmod(file, 0o600);
    let finished = false;
    const writing = appendExcludedRecord(
      sourceDir,
      { kind: "Personnel", key: "one", reason: "updated" },
      { replace: true },
    ).finally(() => {
      finished = true;
    });
    const observing = (async () => {
      const modes: number[] = [];
      while (!finished) {
        const pending = await stat(`${file}.tmp`).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          },
        );
        if (pending !== undefined) modes.push(pending.mode & 0o7777);
      }
      return modes;
    })();
    const results = await Promise.allSettled([writing, observing]);
    expect(results[0].status).toBe("fulfilled");
    if (results[1].status !== "fulfilled") throw results[1].reason;
    expect(results[1].value.length).toBeGreaterThan(0);
    expect(results[1].value.every((mode) => mode === 0o600)).toBe(true);
    expect((await stat(file)).mode & 0o7777).toBe(0o600);
  } finally {
    process.umask(previousMask);
  }
});

it.each([
  [0o022, 0o644],
  [0o077, 0o600],
  [0o002, 0o664],
])(
  "keeps default new-file permissions under umask %s",
  async (mask, expected) => {
    const previousMask = process.umask(mask);
    try {
      const file = await appendExcludedRecord(sourceDir, {
        kind: "Personnel",
        key: "one",
        reason: "new record",
      });
      expect((await stat(file)).mode & 0o7777).toBe(expected);
    } finally {
      process.umask(previousMask);
    }
  },
);

it("overlapping replacements preserve every successful write or visibly reject contention", async () => {
  const first = { kind: "Personnel", key: "one", reason: "first original" };
  const second = { kind: "Personnel", key: "two", reason: "second original" };
  await appendExcludedRecord(sourceDir, first);
  await appendExcludedRecord(sourceDir, second);
  const replacements = [
    { ...first, reason: "first updated", when: { first_name: "9" } },
    { ...second, reason: "second updated", when: { first_name: "8" } },
  ];
  const outcomes = await Promise.allSettled(
    replacements.map((record) =>
      appendExcludedRecord(sourceDir, record, { replace: true }),
    ),
  );
  expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
  const records = await loadExcludedRecords(sourceDir);
  expect(records.size).toBe(2);
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status === "fulfilled") {
      expect(records.get(`Personnel:${replacements[index].key}`)).toMatchObject(
        replacements[index],
      );
    } else {
      expect(outcome.reason).toBeInstanceOf(Error);
      expect(outcome.reason.message).toMatch(
        /another exclusion write.*in progress/i,
      );
      expect(records.get(`Personnel:${replacements[index].key}`)).toMatchObject(
        [first, second][index],
      );
    }
  }
});

it("readers see a complete document throughout replacement", async () => {
  await appendExcludedRecord(sourceDir, {
    kind: "Personnel",
    key: "one",
    reason: "original",
  });
  const reason = "replacement evidence ".repeat(20000);
  let finished = false;
  const write = appendExcludedRecord(
    sourceDir,
    { kind: "Personnel", key: "one", reason },
    { replace: true },
  ).finally(() => {
    finished = true;
  });
  const read = (async () => {
    const snapshots: Array<{ size: number; complete: boolean }> = [];
    while (!finished) {
      const records = await loadExcludedRecords(sourceDir);
      const current = records.get("Personnel:one")?.reason;
      snapshots.push({
        size: records.size,
        complete: current === "original" || current === reason.trim(),
      });
    }
    return snapshots;
  })();
  const results = await Promise.allSettled([write, read]);
  expect(results[0].status).toBe("fulfilled");
  expect(results[1].status).toBe("fulfilled");
  if (results[1].status !== "fulfilled") throw results[1].reason;
  expect(results[1].value.length).toBeGreaterThan(0);
  expect(
    results[1].value.every(
      (snapshot) => snapshot.size === 1 && snapshot.complete,
    ),
  ).toBe(true);
});

afterEach(async () => {
  await rm(sourceDir, { recursive: true, force: true });
});

describe("loadExcludedRecords", () => {
  it("returns an empty set when the source has no excluded.yaml", async () => {
    const excluded = await loadExcludedRecords(sourceDir);
    expect(excluded.size).toBe(0);
  });

  it("reads excluded.yaml keyed by kind:key, carrying the reason and optional name", async () => {
    await writeFile(
      path.join(sourceDir, "excluded.yaml"),
      [
        "excluded:",
        "  - kind: Agency",
        '    key: "41105"',
        '    name: "BRAZOS CO. CONST. PCT. 5"',
        '    reason: "addressless county agency (no location in TCOLE export)"',
        "  - kind: Agency",
        "    key: '45101'",
        '    reason: "addressless county agency"',
      ].join("\n"),
      "utf8",
    );

    const excluded = await loadExcludedRecords(sourceDir);
    expect(excluded.size).toBe(2);

    const first = excluded.get(excludedRecordKey("Agency", "41105"));
    expect(first).toEqual({
      kind: "Agency",
      key: "41105",
      name: "BRAZOS CO. CONST. PCT. 5",
      reason: "addressless county agency (no location in TCOLE export)",
    });

    // an entry without a `name` still round-trips, with `name` left undefined
    const second = excluded.get(excludedRecordKey("Agency", "45101"));
    expect(second).toEqual({
      kind: "Agency",
      key: "45101",
      name: undefined,
      reason: "addressless county agency",
    });
  });

  it("rejects an entry missing a required field", async () => {
    await writeFile(
      path.join(sourceDir, "excluded.yaml"),
      ["excluded:", "  - kind: Agency", '    key: "41105"'].join("\n"),
      "utf8",
    );

    await expect(loadExcludedRecords(sourceDir)).rejects.toThrow(
      /requires a non-empty reason/,
    );
  });

  it("propagates malformed YAML as an error", async () => {
    await writeFile(
      path.join(sourceDir, "excluded.yaml"),
      "excluded: [this is not: valid: yaml",
      "utf8",
    );

    await expect(loadExcludedRecords(sourceDir)).rejects.toThrow(
      /is malformed/,
    );
  });

  it("preserves exact typed source conditions", async () => {
    await writeFile(
      path.join(sourceDir, "excluded.yaml"),
      'excluded:\n  - kind: Personnel\n    key: "42"\n    reason: incomplete source name\n    when:\n      first_name: null\n      score: 0\n      active: false\n      details: {names: ["9", "Townsend"]}\n',
    );
    expect(
      (await loadExcludedRecords(sourceDir)).get("Personnel:42"),
    ).toMatchObject({
      when: {
        first_name: null,
        score: 0,
        active: false,
        details: { names: ["9", "Townsend"] },
      },
    });
  });

  it.each(["{}", "[]", "null", '"name"', "false", "1", "{name: .nan}"])(
    "rejects invalid when conditions %s",
    async (condition) => {
      await writeFile(
        path.join(sourceDir, "excluded.yaml"),
        `excluded:\n  - kind: Personnel\n    key: "42"\n    reason: incomplete source name\n    when: ${condition}\n`,
      );
      await expect(loadExcludedRecords(sourceDir)).rejects.toThrow(/when/);
    },
  );
});
