import {
  Resolver,
  valueAsString,
  type ForeignKeyBackend,
  type ResolverContext,
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
