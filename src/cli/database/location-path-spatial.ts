export type LocationPathCentroid = {
  type: "Point";
  coordinates: [number, number];
};

export type LocationPathBbox = {
  type: "Polygon";
  coordinates: [
    [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ],
  ];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function locationPathCentroidGeoJson(value: unknown): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).type !== "Point" ||
    !Array.isArray((value as Record<string, unknown>).coordinates) ||
    (value as LocationPathCentroid).coordinates.length !== 2 ||
    !isFiniteNumber((value as LocationPathCentroid).coordinates[0]) ||
    !isFiniteNumber((value as LocationPathCentroid).coordinates[1])
  ) {
    return null;
  }

  return JSON.stringify(value);
}

export function locationPathBboxGeoJson(value: unknown): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).type !== "Polygon" ||
    !Array.isArray((value as Record<string, unknown>).coordinates) ||
    !Array.isArray((value as LocationPathBbox).coordinates[0]) ||
    (value as LocationPathBbox).coordinates[0].length !== 5 ||
    !(value as LocationPathBbox).coordinates[0].every(
      (coordinate) =>
        Array.isArray(coordinate) &&
        coordinate.length === 2 &&
        isFiniteNumber(coordinate[0]) &&
        isFiniteNumber(coordinate[1]),
    )
  ) {
    return null;
  }

  return JSON.stringify(value);
}
