import { expect, it } from "vitest";
import { patrolBeatBoundaries } from "../../../sources/gov.irvingtx.arrests/beats.js";
const geometry = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
};
it("publishes patrol names and boundaries only, keeping numeric names", () => {
  const features = ["PD1", "PD2", "OTHER"].map((BattalionC, index) => ({
    properties: {
      Code: String(index),
      Name: String(index),
      BattalionC,
      IsActive: 1,
      private: "omit",
    },
    geometry,
  }));
  expect(patrolBeatBoundaries({ type: "FeatureCollection", features })).toEqual(
    [0, 1].map((index) => ({
      code: String(index),
      name: String(index),
      geometry,
    })),
  );
});
it("rejects missing names and duplicate patrol codes", () => {
  const feature = {
    properties: { Code: "21", Name: "21", BattalionC: "PD1", IsActive: 1 },
    geometry,
  };
  expect(() => patrolBeatBoundaries({ features: [feature, feature] })).toThrow(
    /duplicate/i,
  );
  expect(() =>
    patrolBeatBoundaries({
      features: [
        { ...feature, properties: { ...feature.properties, Name: undefined } },
      ],
    }),
  ).toThrow();
});
