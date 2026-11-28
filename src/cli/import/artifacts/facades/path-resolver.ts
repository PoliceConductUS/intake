import {
  Resolver,
  valueAsString,
  type ForeignKeyBackend,
  type ResolverContext,
  type SelectorBackend,
} from "../resolver-kit.js";

type Row = Record<string, unknown>;
type RelatedProperty = { kind: string; reference: string; property: string };

/** Derive a child path from resolved fields; all dependencies are explicit. */
export function childPathResolver(options: {
  property: string;
  parent: RelatedProperty;
  label: string | RelatedProperty;
}): Resolver<string, ResolverContext<Row, ForeignKeyBackend>> {
  async function related(
    context: ResolverContext<Row, ForeignKeyBackend>,
    field: RelatedProperty,
  ): Promise<string> {
    const reference = valueAsString(context.facade.raw(field.reference));
    if (reference === undefined)
      throw new Error(
        `Missing ${field.reference} for ${context.source.namespace}/${context.source.name}.`,
      );
    const target = context.backend.findForeignKeyTarget({
      kind: field.kind,
      namespace: context.source.namespace,
      sourceId: reference,
    });
    if (target === undefined)
      throw new Error(
        `Cannot derive ${options.property}: missing ${field.kind} source ${context.source.namespace}/${reference}.`,
      );
    const value = valueAsString(await target.value(field.property));
    if (value === undefined)
      throw new Error(
        `Cannot derive ${options.property}: ${field.kind} ${reference}.${field.property} is empty.`,
      );
    return value;
  }
  async function inputs(context: ResolverContext<Row, ForeignKeyBackend>) {
    const parent = await related(context, options.parent);
    const label =
      typeof options.label === "string"
        ? valueAsString(await context.facade.value(options.label))
        : await related(context, options.label);
    if (label === undefined)
      throw new Error(
        `Cannot derive ${options.property}: label is empty for ${context.source.namespace}/${context.source.name}.`,
      );
    return { parent, label };
  }
  return new Resolver(
    async (context) => {
      const supplied = valueAsString(context.facade.raw(options.property));
      if (supplied !== undefined) return supplied;
      const { parent, label } = await inputs(context);
      const segment = label
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!parent.startsWith("/") || !parent.endsWith("/") || !segment)
        throw new Error(
          `Cannot derive ${options.property} from parent ${JSON.stringify(parent)} and label ${JSON.stringify(label)}.`,
        );
      return `${parent}${segment}/`;
    },
    {},
    inputs,
  );
}

/**
 * Derive a location row's own URL segment from its resolved path and its
 * parent's path (a row without a parent has the parent path "/"). The path
 * must be the parent path plus one segment of lowercase letters, digits and
 * hyphens plus "/"; anything else fails loudly. A supplied segment must equal
 * the derived one.
 */
export function pathSegmentResolver(options: {
  path: string;
  parent: RelatedProperty;
}): Resolver<
  string,
  ResolverContext<Row, ForeignKeyBackend & SelectorBackend>
> {
  async function parentPath(
    context: ResolverContext<Row, ForeignKeyBackend & SelectorBackend>,
  ): Promise<string> {
    const raw = context.facade.raw(options.parent.reference);
    if (raw === null) return "/";
    const reference = valueAsString(raw);
    if (reference !== undefined) {
      const target = context.backend.findForeignKeyTarget({
        kind: options.parent.kind,
        namespace: context.source.namespace,
        sourceId: reference,
      });
      if (target !== undefined) {
        const value = valueAsString(
          await target.value(options.parent.property),
        );
        if (value !== undefined) return value;
      }
    }
    const parentId = valueAsString(
      await context.facade.value(options.parent.reference),
    );
    if (parentId === undefined) return "/";
    const rows = await context.backend.findRowsByColumns(options.parent.kind, {
      location_path_id: parentId,
    });
    const value = valueAsString(rows[0]?.[options.parent.property]);
    if (rows.length !== 1 || value === undefined)
      throw new Error(
        `Cannot derive segment: ${options.parent.kind} ${parentId}.${options.parent.property} is missing.`,
      );
    return value;
  }
  return new Resolver(async (context) => {
    const path = valueAsString(await context.facade.value(options.path));
    const parent = await parentPath(context);
    const segment =
      path !== undefined && path.startsWith(parent) && path.endsWith("/")
        ? path.slice(parent.length, -1)
        : "";
    if (!/^[a-z0-9-]+$/.test(segment))
      throw new Error(
        `Cannot derive segment: path ${JSON.stringify(path)} is not parent ${JSON.stringify(parent)} plus one segment.`,
      );
    const supplied = valueAsString(context.facade.raw("segment"));
    if (supplied !== undefined && supplied !== segment)
      throw new Error(
        `Supplied segment ${JSON.stringify(supplied)} does not match path ${JSON.stringify(path)}.`,
      );
    return segment;
  });
}
