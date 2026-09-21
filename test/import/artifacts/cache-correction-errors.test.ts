import { expect, test } from "vitest";
import {
  EntityFacade,
  type EntityResolvers,
} from "../../../src/cli/import/artifacts/facades/entity-facade.js";
import { Resolver } from "../../../src/cli/import/artifacts/resolver-kit.js";
import { RESOLVED_PROPERTIES } from "../../../src/shared/io/generated/entity-specs.js";

type Row = Record<string, unknown>;
function fixture(kind: string, property: string, sourceId = "source-123") {
  const failure = new Error("Required value could not be resolved");
  const resolvers: EntityResolvers<Row> = {
    id: new Resolver(async () => "canonical-456"),
    [property]: new Resolver(async () => {
      throw failure;
    }),
    dependent: new Resolver(async ({ facade }) => facade.value(property)),
  };
  const facade = new EntityFacade<Row, never>(
    kind,
    [],
    resolvers,
    {} as never,
    {
      source: { namespace: "test.source", name: sourceId },
      backend: {} as never,
      cache: { read: async () => undefined, write: async () => {} },
      cacheableProperties: RESOLVED_PROPERTIES[kind],
    },
  );
  return { facade, failure };
}

test.each([
  ["Agency", "location_path_id"],
  ["Personnel", "slug"],
  ["FederalAgency", "slug"],
  ["CivilCase", "location_path_id"],
])(
  "%s.%s failure includes its cache command arguments",
  async (kind, property) => {
    const { facade, failure } = fixture(kind, property);
    const result = facade.value(property);
    await expect(result).rejects.toMatchObject({ cause: failure });
    for (const detail of [
      "canonical-456",
      failure.message,
      `npm run cli -- cache get test.source ${kind} source-123 ${property}`,
      `npm run cli -- cache set test.source ${kind} source-123 ${property} 'REPLACE_WITH_VERIFIED_VALUE'`,
      "--force",
    ])
      await expect(result).rejects.toThrow(detail);
  },
);

test("dependent failures retain the failing property's correction once", async () => {
  const { facade } = fixture("Agency", "latitude");
  const error = await facade.value("dependent").catch((error: Error) => error);
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message.match(/cache set /g)).toHaveLength(1);
  expect(message).toContain("Agency source-123 latitude");
  expect(message).not.toContain("Agency source-123 dependent");
});

test("does not suggest cache overrides for source-provided or non-cacheable values", async () => {
  const sourceProvided = fixture("Agency", "latitude");
  sourceProvided.facade.merge({ latitude: 1 });
  await expect(sourceProvided.facade.value("latitude")).rejects.toBe(
    sourceProvided.failure,
  );
  const notCached = fixture("Agency", "name");
  await expect(notCached.facade.value("name")).rejects.toBe(notCached.failure);
});

test("quotes source IDs containing shell metacharacters", async () => {
  const { facade } = fixture("Personnel", "slug", "O'Brien $(touch injected)");
  await expect(facade.value("slug")).rejects.toThrow(
    "cache set test.source Personnel 'O'\\''Brien $(touch injected)' slug",
  );
});
