// The canonical form of a license type name, shared by every source and the
// import resolver so "the same license" reads identically everywhere: whitespace
// collapsed and a trailing " License" dropped (the type is already a license).
// Must byte-match the SQL `canonical_license_type` used to backfill the schema.
export function canonicalLicenseType(rawType: string): string {
  return rawType
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+license$/i, "");
}
