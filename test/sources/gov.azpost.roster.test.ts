import { describe, it, expect } from "vitest";
import { run } from "../../sources/gov.azpost.roster/run.js";

const rows = [
  {
    "POST ID": "1001",
    LAST: "Woodward",
    FIRST: "Skip",
    MIDDLE: "L",
    AGENCY: "Tempe PD",
  },
  {
    "POST ID": "1002",
    LAST: "Denney",
    FIRST: "Marc",
    MIDDLE: "E",
    AGENCY: "Mesa PD",
  },
  {
    "POST ID": "1002",
    LAST: "Denney",
    FIRST: "Marc",
    MIDDLE: "E",
    AGENCY: "Tempe PD",
  },
  {
    "POST ID": "",
    LAST: "Nokey",
    FIRST: "Ann",
    MIDDLE: "",
    AGENCY: "Tempe PD",
  },
];
const fakeReadXlsx = async () => rows;
const fakeEmit = async () => {};

describe("gov.azpost.roster run", () => {
  it("returns deduped Personnel keyed by POST ID, skipping blank ids", async () => {
    const manifest = await run({
      paths: ["a.xlsx"],
      readXlsx: fakeReadXlsx,
      state: "/state",
      emit: fakeEmit,
    });
    expect(manifest.artifacts).toHaveLength(1);
    const personnel = manifest.artifacts[0];
    expect(personnel.kind).toBe("Personnel");
    expect(Object.keys(personnel.records).sort()).toEqual(["1001", "1002"]);
    expect(personnel.records["1001"].spec).toEqual({
      id: "1001",
      first_name: "Skip",
      last_name: "Woodward",
      middle_name: "L",
    });
    expect(personnel.records["1002"].spec).toMatchObject({ middle_name: "E" });
  });

  it("is deterministic", async () => {
    expect(
      await run({
        paths: ["a"],
        readXlsx: fakeReadXlsx,
        state: "/state",
        emit: fakeEmit,
      }),
    ).toEqual(
      await run({
        paths: ["a"],
        readXlsx: fakeReadXlsx,
        state: "/state",
        emit: fakeEmit,
      }),
    );
  });
});
