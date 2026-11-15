import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { migrateState } from "../../../src/cli/workspace/migrate-state.js";
import { SourceNameToCanonicalId } from "../../../src/cli/state/source-name-to-canonical-id/SourceNameToCanonicalId.js";
import { CanonicalIdToSourceName } from "../../../src/cli/state/source-name-to-canonical-id/CanonicalIdToSourceName.js";
import { ResolvedProperty } from "../../../src/cli/state/resolved-property/ResolvedProperty.js";
import { yamlResourceFileName } from "../../../src/shared/io/resource.js";
import {
  appendEntry,
  readLatest,
} from "../../../src/cli/state/manual-records.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";

it("migrates both directions of identity, keyed provenance, pointers and private state on restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "migrate-state-"));
  const from = path.join(root, "before"),
    to = path.join(root, "after"),
    next = "org/example/news";
  try {
    const ledger = "state/intake/namespaces";
    const oldId = "old/hash",
      newId = "new/hash";
    const names = { "old.news": next };
    const oldOutput = "command/run/old.news/output",
      newOutput = "command/run/" + next + "/output";
    await mkdir(path.join(to, newOutput), { recursive: true });
    await mkdir(path.join(from, oldOutput), { recursive: true });
    await mkdir(path.join(from, "state/old.news"), { recursive: true });
    await writeFile(
      path.join(from, "state/old.news/acquire.yaml"),
      "latest: " +
        oldOutput +
        "\nresume: command/interrupted/old.news/output\n",
    );
    await appendEntry(
      path.join(from, "state/old.news"),
      {
        kind: "Agency",
        record: { name: "old.news", source_exclusions: { "old.news": [] } },
      },
      "name",
    );
    const cases: [string, string, string, string][] = [
      ["old.news", "CoverageLink", "https://publisher.test/old.news", "one"],
      ["intake", "DataAnnotation", oldId, "two"],
    ];
    for (const [namespace, kind, name, id] of cases) {
      const dir = path.join(from, ledger, namespace, kind);
      await SourceNameToCanonicalId.write(
        dir,
        SourceNameToCanonicalId.new({
          metadata: { name, namespace },
          spec: { kind, canonicalId: id },
        }),
      );
      await CanonicalIdToSourceName.write(
        dir,
        CanonicalIdToSourceName.new({
          metadata: { name: id, namespace },
          spec: { kind, sourceName: name },
        }),
      );
    }
    const resolved = ResolvedProperty.new({
      metadata: { name: "slug", namespace: "intake" },
      spec: {
        subject: {
          apiVersion: INTAKE_API_VERSION,
          kind: "Personnel",
          name: "one",
        },
        targetProperty: "slug",
        entries: [
          {
            value: "old.news",
            sources: { "old.news": { kind: "Personnel", name: "old.news" } },
          },
        ],
      },
    });
    await ResolvedProperty.write(
      path.join(from, ledger, "intake", "ResolvedProperty"),
      resolved,
    );
    const options = {
      from,
      to,
      namespaces: names,
      commandPaths: { [oldOutput]: newOutput },
      annotationIds: { [oldId]: newId },
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await migrateState(options);
      expect(result.omittedPointers).toContainEqual(
        expect.stringContaining("command/interrupted/old.news/output"),
      );
      for (const [original, kind, name, id] of cases) {
        const namespace = original === "intake" ? "intake" : next,
          key = kind === "DataAnnotation" ? newId : name;
        const dir = path.join(to, ledger, namespace, kind);
        expect(
          (
            await SourceNameToCanonicalId.read(
              path.join(
                dir,
                yamlResourceFileName(key, "SourceNameToCanonicalId"),
              ),
              { expectedNamespace: namespace },
            )
          ).spec.canonicalId,
        ).toBe(id);
        expect(
          (
            await CanonicalIdToSourceName.read(
              path.join(
                dir,
                yamlResourceFileName(id, "CanonicalIdToSourceName"),
              ),
            )
          ).spec.sourceName,
        ).toBe(key);
      }
      expect(
        (await readLatest(path.join(to, "state", next))).entries[0].record,
      ).toEqual({ name: "old.news", source_exclusions: { [next]: [] } });
      expect(
        (await readLatest(path.join(from, "state/old.news"))).entries[0].record
          .source_exclusions,
      ).toEqual({ "old.news": [] });
      const saved = await ResolvedProperty.read(
        path.join(
          to,
          ledger,
          "intake",
          "ResolvedProperty",
          "slug.ResolvedProperty.yaml",
        ),
      );
      expect(saved.spec.entries[0]).toEqual({
        value: "old.news",
        sources: { [next]: { kind: "Personnel", name: "old.news" } },
      });
      expect(
        await readFile(path.join(to, "state", next, "acquire.yaml"), "utf8"),
      ).toBe("latest: " + newOutput + "\n");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps raw responses intact and rewrites private article and search-page references", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "migrate-search-"));
  const from = path.join(root, "original"),
    to = path.join(root, "dev"),
    old = "news",
    next = "com/search/news";
  try {
    const folder = path.join(
      from,
      "intake/state/namespaces",
      old,
      "daily-pilot",
      old,
    );
    await mkdir(folder, { recursive: true });
    await mkdir(to);
    const sourceId = "https://publisher.com/news";
    const oldRef = JSON.stringify([old, sourceId]),
      newRef = JSON.stringify([next, sourceId]);
    const response = {
      namespace: old,
      articleKey: "raw source bytes",
      paragraphs: ["news"],
    };
    const data = {
      value: {
        response,
        requestedPages: [old + "/searches/page.json"],
        matches: [{ articleKey: oldRef }],
        visible: { [JSON.stringify(["/profile", oldRef])]: "yesterday" },
        comparisons: { [JSON.stringify(["term", "/profile", oldRef])]: {} },
        pending: { key: old + "/batches/id.json" },
      },
      etag: "original-etag",
    };
    await writeFile(path.join(folder, "state.json"), JSON.stringify(data));
    const options = {
      from,
      to,
      namespaces: { [old]: next },
      commandPaths: {},
      annotationIds: {},
    };
    await migrateState(options);
    const target = path.join(
      to,
      "intake/state/namespaces",
      next,
      "daily-pilot",
      next,
      "state.json",
    );
    const got = JSON.parse(await readFile(target, "utf8"));
    expect(got.value).toEqual({
      response,
      requestedPages: [next + "/searches/page.json"],
      matches: [{ articleKey: newRef }],
      visible: { [JSON.stringify(["/profile", newRef])]: "yesterday" },
      comparisons: { [JSON.stringify(["term", "/profile", newRef])]: {} },
      pending: { key: next + "/batches/id.json" },
    });
    await writeFile(target, "unrelated");
    await expect(migrateState(options)).rejects.toThrow(
      "Conflicting destination file",
    );
    expect(await readFile(target, "utf8")).toBe("unrelated");
    await expect(migrateState({ ...options, to: from })).rejects.toThrow(
      "separate directories",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("archives an obsolete source-scoped property after checking its active canonical counterpart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "migrate-old-property-"));
  const from = path.join(root, "before"),
    to = path.join(root, "after"),
    ns = "old.news",
    next = "org/news",
    name = "source:7",
    id = "agency-id",
    kind = "Agency",
    property = "longitude";
  try {
    await mkdir(to);
    const ledger = path.join(from, "state/intake/namespaces"),
      folder = path.join(ledger, "intake/ResolvedProperty");
    await SourceNameToCanonicalId.write(
      path.join(ledger, ns, kind),
      SourceNameToCanonicalId.new({
        metadata: { namespace: ns, name },
        spec: { kind, canonicalId: id },
      }),
    );
    const subject = { apiVersion: INTAKE_API_VERSION, kind, name: id } as const;
    const current = ResolvedProperty.new({
      metadata: {
        name: [INTAKE_API_VERSION, kind, id, property].join(":"),
        namespace: "intake",
      },
      spec: {
        subject,
        targetProperty: property,
        entries: [{ inputFingerprint: "new-digest", value: -96 }],
      },
    });
    await ResolvedProperty.write(folder, current);
    const fp = "0".repeat(64),
      oldName = [INTAKE_API_VERSION, ns, kind, name, property, fp].join(":");
    const oldFile = yamlResourceFileName(oldName, "ResolvedProperty");
    const old =
      "apiVersion: " +
      INTAKE_API_VERSION +
      "\nkind: ResolvedProperty\nmetadata:\n  name: " +
      oldName +
      "\n  namespace: intake\nspec:\n  subject:\n    apiVersion: " +
      INTAKE_API_VERSION +
      "\n    namespace: " +
      ns +
      "\n    kind: " +
      kind +
      "\n    name: " +
      name +
      "\n  targetProperty: " +
      property +
      '\n  inputFingerprint: "' +
      fp +
      '"\n  value: -95\n';
    await writeFile(path.join(folder, oldFile), old);
    const options = {
      from,
      to,
      namespaces: { [ns]: next },
      commandPaths: {},
      annotationIds: {},
    };
    const result = await migrateState(options);
    expect(result.archivedProperties).toBe(1);
    const archive = path.join(
      to,
      "backups/namespace-migration/source-scoped-resolved-properties",
    );
    expect(await readFile(path.join(archive, oldFile), "utf8")).toBe(old);
    expect(
      JSON.parse(
        await readFile(path.join(archive, "manifest.json"), "utf8"),
      )[0],
    ).toMatchObject({
      originalNamespace: ns,
      namespace: next,
      canonicalId: id,
      originalFile: oldFile,
      valueMatches: false,
    });
    const migrated = await ResolvedProperty.read(
      path.join(
        to,
        "state/intake/namespaces/intake/ResolvedProperty",
        yamlResourceFileName(current.metadata.name, current.kind),
      ),
    );
    expect(migrated.spec.entries).toEqual(current.spec.entries);
    expect((await migrateState(options)).archivedProperties).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
