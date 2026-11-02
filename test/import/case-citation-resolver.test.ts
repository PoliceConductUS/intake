import { expect, it } from "vitest";
import { civilCaseSlugResolver } from "../../src/cli/import/artifacts/facades/agency-personnel-resolvers.js";

it("derives a new citation slug but preserves an established slug until migration", async () => {
  const raw: Record<string, unknown> = {
    title: "Example v. City",
    cause_number: "1:25-cv-123",
    court: "txnd",
    filed_date: "2025-01-02",
  };
  const context = {
    facade: { value: async () => "same-id", raw: (key: string) => raw[key] },
    source: { namespace: "any-source", name: "source-id" },
    backend: {
      ensureUniqueSlug: async ({ base }: { base: string }) => base,
      registerSlug: async () => {},
      existingRow: async (): Promise<Record<string, unknown> | undefined> =>
        undefined,
    },
  };
  const resolver = civilCaseSlugResolver();
  expect(await resolver.resolve(context, () => "unresolved")).toBe(
    "example-v-city-no-1-25-cv-123-n-d-tex-filed-jan-2-2025",
  );
  context.backend.existingRow = async () => ({
    id: "same-id",
    slug: "old-url",
  });
  expect(await resolver.resolve(context, () => "unresolved")).toBe("old-url");
});

it("does not silently suffix an ambiguous citation", async () => {
  const raw: Record<string, unknown> = {
    title: "Example v. City",
    cause_number: "123",
    court: "txnd",
    filed_date: "2025-01-02",
  };
  await expect(
    civilCaseSlugResolver().resolve(
      {
        facade: {
          value: async () => "same-id",
          raw: (key: string) => raw[key],
        },
        source: { namespace: "source", name: "case" },
        backend: {
          existingRow: async () => undefined,
          registerSlug: async () => {},
          ensureUniqueSlug: async ({ base }) => `${base}-2`,
        },
      },
      () => "unresolved",
    ),
  ).rejects.toThrow(/collision/i);
});
