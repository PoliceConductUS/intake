import { describe, it, expect } from "vitest";
import { newsManifest } from "../../../sources/lib/news-import.js";
import { buildArtifactsEnvelope } from "../../../src/cli/transform/source-transform.js";
import type { ReleaseArticle } from "../../../sources/lib/news.js";
const source = (namespace: string): ReleaseArticle => ({
  namespace,
  sourceId: "same",
  preferredUrl: "https://" + namespace + ".example",
  normalizedUrl: "https://" + namespace + ".example",
  occurrences: {
    ["https://" + namespace + ".example"]: {
      url: "https://" + namespace + ".example",
      title: "Report",
      sourceName: "Source",
      publishedAt: "2026-11-08",
      summary: "Independent summary",
    },
  },
  relationships: [
    {
      namespace,
      sourceId: "link",
      agencyPersonnelId: "existing",
      occurrenceUrl: "https://" + namespace + ".example",
      confidence: "documented",
      notes: null,
    },
  ],
});
describe("permanent news import", () => {
  it("retains two originating namespaces with the same source ID and references a supplied assignment", async () => {
    const articles = [source("a"), source("b")];
    const manifest = await newsManifest(articles, undefined, {
      assignmentRef: async (id) => "local-" + id,
      existingArticle: async () => undefined,
    });
    const env = buildArtifactsEnvelope(
      "org.policeconduct.release-news",
      "hash",
      manifest,
    );
    const rows = env.spec.artifacts.find((k) => k.kind === "CoverageLinks")!
      .spec.records;
    expect(
      Object.values(rows).map((r: any) => [
        r.spec.source_namespace,
        r.spec.source_id,
      ]),
    ).toEqual([
      ["a", "same"],
      ["b", "same"],
    ]);
    expect(
      Object.keys(
        env.spec.artifacts.find(
          (k) => k.kind === "CoverageLinkAgencyPersonnel",
        )!.spec.records,
      ),
    ).toHaveLength(2);
  });
  it("retains a better original on importing an older release and reuses a canonical baseline selector", async () => {
    const older = source("a");
    const newer = source("a");
    newer.preferredUrl = "https://original.example/news";
    newer.occurrences = {
      [newer.preferredUrl]: {
        ...Object.values(older.occurrences)[0]!,
        url: newer.preferredUrl,
        domainRank: 1,
      },
    };
    const { artifacts } = await newsManifest(
      [{ ...older, canonicalId: "known" }],
      undefined,
      { assignmentRef: async (id) => id, existingArticle: async () => newer },
    );
    const record = Object.values(
      artifacts.find((k) => k.kind === "CoverageLinks")!.records,
    )[0]!;
    expect(record).toMatchObject({
      metadata: { action: "PATCH", selector: { id: "known" } },
      spec: { url: newer.preferredUrl },
    });
  });
});
