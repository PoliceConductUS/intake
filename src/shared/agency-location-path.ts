export type AgencyLocationPathLookup = (
  id: string,
) => Promise<{ location_path_id: string; level: string } | undefined>;

export async function requireAgencyPlaceLocationPath(
  agencyId: string,
  locationPathId: unknown,
  getLocationPathById: AgencyLocationPathLookup | undefined,
): Promise<void> {
  if (typeof locationPathId !== "string" || getLocationPathById === undefined) {
    throw new Error(
      `Agency ${agencyId} location_path_id must be verified as an existing place.`,
    );
  }
  const location = await getLocationPathById(locationPathId);
  if (
    location === undefined ||
    location.location_path_id !== locationPathId ||
    location.level !== "place"
  ) {
    throw new Error(
      `Agency ${agencyId} location_path_id ${locationPathId} must reference an existing place; found ${location?.level ?? "missing"}.`,
    );
  }
}
