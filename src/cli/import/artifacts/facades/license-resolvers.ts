import { titleCase } from "../case-normalization.js";
import {
  Resolver,
  valueAsString,
  type ResolverContext,
} from "../resolver-kit.js";

type Row = Record<string, unknown>;

// Bare-form license types → their canonical "… License" form, so casing/suffix
// variants of one license do not read as different types.
const LICENSE_TYPE_CANONICAL: Record<string, string> = {
  "peace officer": "Peace Officer License",
  "telecommunications operator": "Telecommunications Operator License",
};

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** License status in Title Case (ACTIVE/Active → Active); blank → null. */
export function licenseStatusResolver(): Resolver<
  string | null,
  ResolverContext<Row, unknown>
> {
  return new Resolver(async ({ facade }) => {
    const raw = valueAsString(facade.raw("status"));
    return raw === undefined ? null : titleCase(collapseWhitespace(raw));
  });
}

/** License type: whitespace collapsed and bare-form dupes mapped to canonical. */
export function licenseTypeResolver(): Resolver<
  string,
  ResolverContext<Row, unknown>
> {
  return new Resolver(async ({ facade, source }) => {
    const raw = valueAsString(facade.raw("license_type"));
    if (raw === undefined) {
      throw new Error(
        `License ${source.namespace}/${source.name} has no license_type.`,
      );
    }
    const normalized = collapseWhitespace(raw);
    return LICENSE_TYPE_CANONICAL[normalized.toLowerCase()] ?? normalized;
  });
}
