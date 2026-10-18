import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { readDocumentEvidence } from "../../../../sources/mn-post/acquire/document-evidence.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture(change: (doc: Record<string, any>) => void) {
  const root = await mkdtemp(path.join(tmpdir(), "absence-contract-"));
  roots.push(root);
  const bytes = Buffer.from("pdf");
  const doc = {
    url: "https://example.test/order",
    documentName: "Order",
    actions: [{ contactId: "person", caseNumber: "case" }],
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    fetchedAt: "2026-10-18",
    pages: [{ page: 1, method: "text", text: "Board suspended license." }],
    text: "Board suspended license.",
    analysis: {
      allegation: null,
      violation: null,
      finding: "Board suspended license.",
      chief_action: null,
      sanction: "Board suspended license.",
    },
    analyzedWith: { model: "automated", promptVersion: 2 },
  };
  change(doc);
  const file = path.join(root, "order.document.json");
  await writeFile(file, JSON.stringify(doc));
  await writeFile(path.join(root, "order.pdf"), bytes);
  return file;
}
it("rejects null narratives without explicit field reasons for every model", async () => {
  for (const model of ["automated", "codex-document-review"]) {
    const file = await fixture((doc) => {
      doc.analyzedWith.model = model;
      if (model === "codex-document-review")
        doc.reviewReceipt = {
          method: model,
          reviewedAt: "2026-10-18",
          fieldEvidence: {
            allegation: [],
            violation: [],
            finding: [{ page: 1, excerpt: "Board suspended license." }],
            chief_action: [],
            sanction: [{ page: 1, excerpt: "Board suspended license." }],
          },
        };
    });
    await expect(readDocumentEvidence(file)).rejects.toThrow();
  }
});
it("rejects blank narratives instead of treating empty text as a value", async () => {
  const file = await fixture((doc) => {
    doc.analysis.allegation = "   ";
    doc.analysis.violation = "";
    doc.analysis.chief_action = " ";
  });
  await expect(readDocumentEvidence(file)).rejects.toThrow();
});
it("rejects old completed analysis even if its narratives are populated", async () => {
  const file = await fixture((doc) => {
    doc.analyzedWith.promptVersion = 1;
    doc.analysis = {
      allegation: "Basis",
      violation: "Rule",
      finding: "Finding",
      chief_action: "Action",
      sanction: "Sanction",
    };
  });
  await expect(readDocumentEvidence(file)).rejects.toThrow();
});

const validReasons = {
  allegation: "The text states no factual basis for suspension.",
  violation: "The text cites no statute or rule violation.",
  chief_action: "The text describes no employer or chief response.",
};
it("accepts precisely the null-field reasons without changing public narratives", async () => {
  const file = await fixture((doc) => {
    doc.absenceReasons = validReasons;
  });
  const doc = await readDocumentEvidence(file);
  expect(doc.absenceReasons).toEqual(validReasons);
  expect(doc.analysis.chief_action).toBeNull();
  expect(Object.keys(doc.analysis)).toHaveLength(5);
});
it.each(["allegation", "violation", "chief_action"])(
  "rejects missing reason for %s",
  async (field) => {
    const file = await fixture((doc) => {
      doc.absenceReasons = { ...validReasons };
      delete doc.absenceReasons[field];
    });
    await expect(readDocumentEvidence(file)).rejects.toThrow(field);
  },
);
it.each(["", "   "])("rejects a blank absence reason %j", async (reason) => {
  const file = await fixture((doc) => {
    doc.absenceReasons = { ...validReasons, chief_action: reason };
  });
  await expect(readDocumentEvidence(file)).rejects.toThrow();
});
it("rejects a populated narrative with an absence reason", async () => {
  const file = await fixture((doc) => {
    doc.absenceReasons = { ...validReasons, finding: "No finding stated." };
  });
  await expect(readDocumentEvidence(file)).rejects.toThrow(/Populated finding/);
});
it("enforces valid null reasons for Codex evidence with page receipts", async () => {
  const file = await fixture((doc) => {
    doc.absenceReasons = validReasons;
    doc.analyzedWith.model = "codex-document-review";
    doc.reviewReceipt = {
      method: "codex-document-review",
      reviewedAt: "2026-10-18",
      fieldEvidence: {
        allegation: [],
        violation: [],
        finding: [{ page: 1, excerpt: "Board suspended license." }],
        chief_action: [],
        sanction: [{ page: 1, excerpt: "Board suspended license." }],
      },
    };
  });
  expect((await readDocumentEvidence(file)).absenceReasons).toEqual(
    validReasons,
  );
});
it("rejects unsupported document prompt versions", async () => {
  const file = await fixture((doc) => {
    doc.analyzedWith.promptVersion = 99;
    doc.absenceReasons = validReasons;
  });
  await expect(readDocumentEvidence(file)).rejects.toThrow(/promptVersion/);
});
