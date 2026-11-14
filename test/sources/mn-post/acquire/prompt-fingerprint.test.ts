import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const roots: string[] = [];
afterEach(async () => {
  vi.doUnmock("node:fs");
  vi.resetModules();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("rejects a saved summary after prompt text changes without a version increment", async () => {
  let promptText = "Read the order and report only its stated facts.";
  vi.doMock("node:fs", () => ({ readFileSync: () => promptText }));
  const before =
    await import("../../../../sources/mn-post/acquire/document-evidence.js");
  const root = await mkdtemp(path.join(tmpdir(), "current-prompt-"));
  roots.push(root);
  const pdf = Buffer.from("synthetic PDF");
  const file = path.join(root, "order.document.json");
  await writeFile(path.join(root, "order.pdf"), pdf);
  await writeFile(
    file,
    JSON.stringify({
      url: "https://example.test/order",
      documentName: "Order",
      actions: [{ contactId: "person", caseNumber: "case" }],
      sha256: createHash("sha256").update(pdf).digest("hex"),
      bytes: pdf.length,
      fetchedAt: "2026-11-13T00:00:00Z",
      pages: [{ page: 1, method: "text", text: "License suspended." }],
      text: "License suspended.",
      analysis: {
        allegation: null,
        violation: null,
        finding: "License suspended.",
        chief_action: null,
        sanction: "License suspended.",
      },
      absenceReasons: {
        allegation: "The order states no allegation.",
        violation: "The order names no rule.",
        chief_action: "The order describes no employer action.",
      },
      analyzedWith: {
        model: "test-model",
        promptSha256: createHash("sha256").update(promptText).digest("hex"),
      },
    }),
  );
  await expect(before.readDocumentEvidence(file)).resolves.toMatchObject({
    analysis: { sanction: "License suspended." },
  });
  promptText +=
    " Preserve the distinction between stipulations and Board findings.";
  vi.resetModules();
  const after =
    await import("../../../../sources/mn-post/acquire/document-evidence.js");
  await expect(after.readDocumentEvidence(file)).rejects.toThrow(
    /promptSha256/,
  );
});
