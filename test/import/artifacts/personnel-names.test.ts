import { describe, expect, it } from "vitest";
import { buildFacadeForKind } from "../../../src/cli/import/artifacts/facades/resolver-registry.js";
import type { EntityFacadeBackend } from "../../../src/cli/import/artifacts/facades/entity-facade.js";

function personnel(source: Record<string, unknown>) {
  const unexpected = () => {
    throw new Error("Name resolution must not require database or identity IO");
  };
  const backend: EntityFacadeBackend = {
    findCanonicalId: unexpected,
    findOrCreateCanonicalId: unexpected,
    businessKeyId: unexpected,
    findIdByBusinessKey: unexpected,
    mintId: unexpected,
    existingRow: unexpected,
    findForeignKeyTarget: unexpected,
    getLocationPathByPath: unexpected,
    findRowsByColumns: unexpected,
  };
  const facade = buildFacadeForKind("Personnel", {
    source: { namespace: "test", name: "person", commandName: "test" },
    backend,
  });
  facade.merge(source);
  return facade;
}

describe("personnel suffix normalization", () => {
  it.each([
    ["JR", "Jr."],
    ["JR.", "Jr."],
    ["jr", "Jr."],
    ["jr.", "Jr."],
    ["Jr", "Jr."],
    ["Jr.", "Jr."],
    ["Jr..", "Jr."],
    ["SR", "Sr."],
    ["SR.", "Sr."],
    ["sr", "Sr."],
    ["sr.", "Sr."],
    ["Sr", "Sr."],
    ["Sr.", "Sr."],
    ["Sr..", "Sr."],
    ["  JR.  ", "Jr."],
    ["III", "III"],
    ["IiI", "III"],
    ["ii", "II"],
    ["", null],
    ["  ", null],
    [null, null],
    [undefined, null],
  ])("resolves %j as %j", async (suffix, expected) => {
    expect(await personnel({ suffix }).value("suffix")).toBe(expected);
  });
});

describe("explicit source name capitalization", () => {
  it.each([
    ["last_name", "Macomb"],
    ["last_name", "DeHoyos"],
    ["first_name", "LaRell"],
    ["last_name", "DeSylva"],
    ["last_name", "DeLosSantosCoy"],
    ["last_name", "VanDevender"],
    ["middle_name", "MacEdonio"],
    ["last_name", "St Amour"],
    ["first_name", 'Auerilo "WALLY"'],
  ])("preserves %s %j", async (property, value) => {
    expect(await personnel({ [property]: value }).value(property)).toBe(value);
  });
  it("normalizes whitespace while retaining source capitals", async () => {
    expect(
      await personnel({ last_name: "  De  La\tCruz " }).value("last_name"),
    ).toBe("De La Cruz");
  });
});

describe("source word boundaries", () => {
  it.each([
    ["ST AMOUR", "St Amour"],
    ["ST ROMAIN", "St Romain"],
    ["st amour", "St Amour"],
    ["  ST\t AMOUR  ", "St Amour"],
    ["JR SMITH", "Jr Smith"],
    ["DR JONES", "Dr Jones"],
    ["MARIA Y GOMEZ", "Maria y Gomez"],
    ["VAN DER BILT", "Van der Bilt"],
    ["DE LA CRUZ", "De la Cruz"],
    ["MCDONALD", "McDonald"],
  ])("resolves %j without losing word boundaries", async (value, expected) => {
    expect(await personnel({ last_name: value }).value("last_name")).toBe(
      expected,
    );
  });
});
