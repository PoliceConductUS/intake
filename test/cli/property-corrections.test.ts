import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  loadPropertyCorrections,
  setPropertyCorrection,
} from "../../src/shared/io/property-corrections.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

test("matches typed original values, fills only missing values, and preserves input", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "corrections-"));
  roots.push(root);
  const base = {
    rootDir: root,
    namespace: "test",
    kind: "Agency",
    sourceId: "one",
    force: false,
    commandId: "cmd",
  };
  await setPropertyCorrection({
    ...base,
    property: "name",
    from: "OLD",
    value: "New",
  });
  await setPropertyCorrection({
    ...base,
    property: "latitude",
    from: null,
    value: 32,
  });
  const apply = await loadPropertyCorrections(root, "test");
  const original = { name: "OLD", latitude: null };
  expect(apply("Agency", "one", original)).toEqual({
    name: "New",
    latitude: 32,
  });
  expect(original).toEqual({ name: "OLD", latitude: null });
  expect(apply("Agency", "one", { name: "Changed", latitude: 0 })).toEqual({
    name: "Changed",
    latitude: 0,
  });
  expect(apply("Agency", "two", original)).toEqual(original);
  expect(apply("Agency", "one", { name: "" })).toEqual({
    name: "",
    latitude: 32,
  });
  await expect(
    setPropertyCorrection({
      ...base,
      property: "name",
      from: "OLD",
      value: "Other",
    }),
  ).rejects.toThrow("--force");
  await setPropertyCorrection({
    ...base,
    property: "name",
    from: "OLD",
    value: "Other",
    force: true,
  });
  expect(
    (await loadPropertyCorrections(root, "test"))("Agency", "one", {
      name: "OLD",
    }),
  ).toEqual({ name: "Other", latitude: 32 });
});

test("canonical correction IO rejects malformed envelopes and multiple active rules", async () => {
  const { PropertyCorrection } =
    await import("../../src/shared/io/PropertyCorrection.js");
  const input = {
    metadata: { name: "test", namespace: "test" },
    spec: {
      subject: { kind: "Agency", name: "one" },
      targetProperty: "name",
      entries: [
        {
          from: null,
          value: "Test",
          commandId: "cmd",
          recordedAt: "2026-09-25T00:00:00.000Z",
        },
      ],
    },
  };
  expect(() =>
    PropertyCorrection.new({
      ...input,
      spec: {
        ...input.spec,
        entries: [...input.spec.entries, ...input.spec.entries],
      },
    }),
  ).toThrow();
  const good = PropertyCorrection.new(input);
  for (const bad of [
    { ...good, apiVersion: "wrong" },
    { ...good, kind: "wrong" },
    { ...good, metadata: { ...good.metadata, extra: true } },
    { ...good, spec: { ...good.spec, extra: true } },
  ])
    expect(PropertyCorrection.schema.safeParse(bad).success).toBe(false);
});
