import { describe, expect, test } from "vitest";
import {
  DataAnnotation,
  replaceCorrectionAnnotations,
} from "../../../src/shared/data-annotations.js";

const correction = (namespace: string, id: string) => ({
  field: "end_date",
  value: "2109-01-01",
  type: "correction" as const,
  message: "Corrected from supplied evidence.",
  source_namespace: namespace,
  source_record_id: id,
  replacement_value: "2019-01-01",
});

describe("record-owned annotations", () => {
  test("requires correction replacement values and rejects extra keys", () => {
    const entry = correction("provider.a", "assignment-1");
    expect(DataAnnotation.parse(entry)).toEqual(entry);
    const { replacement_value: _replacement, ...incomplete } = entry;
    expect(DataAnnotation.safeParse(incomplete).success).toBe(false);
    expect(DataAnnotation.safeParse({ ...entry, id: "invented" }).success).toBe(
      false,
    );
    expect(
      DataAnnotation.safeParse({ ...entry, type: "warning" }).success,
    ).toBe(false);
  });

  test("retains lossless JSON values and optional correction evidence", () => {
    const entry = {
      ...correction("provider.a", "assignment-1"),
      value: { raw: [null, false, "not a date"] },
      evidence: [{ url: "https://example.org/record" }],
    };
    expect(DataAnnotation.parse(entry)).toEqual(entry);
    expect(
      DataAnnotation.safeParse({ ...entry, value: undefined }).success,
    ).toBe(false);
  });

  test("replaces only the processed contribution, retaining warnings and other providers", () => {
    const a1 = correction("provider.a", "assignment-1");
    const a2 = correction("provider.a", "assignment-2");
    const b1 = correction("provider.b", "assignment-1");
    const warning = {
      field: "end_date",
      value: "2109-01-01",
      type: "warning" as const,
      message: "Future date.",
      source_namespace: "provider.a",
      source_record_id: "assignment-1",
    };
    const existing = [a1, a2, b1, warning];
    expect(
      replaceCorrectionAnnotations(existing, {
        source_namespace: "provider.a",
        source_record_id: "assignment-1",
        corrections: [],
      }),
    ).toEqual([a2, b1, warning]);
    const changed = { ...a1, message: "Updated explanation." };
    const scope = {
      source_namespace: "provider.a",
      source_record_id: "assignment-1",
      corrections: [changed],
    };
    const replaced = replaceCorrectionAnnotations(existing, scope);
    expect(replaced).toEqual([a2, b1, warning, changed]);
    expect(replaceCorrectionAnnotations(replaced, scope)).toEqual(replaced);
    expect(existing).toEqual([a1, a2, b1, warning]);
  });

  test("rejects replacement entries attributed to a different contribution", () => {
    expect(() =>
      replaceCorrectionAnnotations([], {
        source_namespace: "provider.a",
        source_record_id: "assignment-1",
        corrections: [correction("provider.b", "assignment-1")],
      }),
    ).toThrow();
  });
});

test("source contributions preserve raw and effective values with strict attribution", async () => {
  const { SourceContribution } =
    await import("../../../src/shared/data-annotations.js");
  const input = {
    source_namespace: "provider.a",
    source_record_id: "assignment-1",
    corrections: [],
    values: {
      end_date: {
        value: "invalid",
        effective_value: null,
        source_namespace: "provider.a",
        source_record_id: "assignment-1",
      },
    },
  };
  expect(SourceContribution.parse(input)).toEqual(input);
  expect(
    SourceContribution.safeParse({ ...input, source_record_id: "assignment-2" })
      .success,
  ).toBe(false);
});
