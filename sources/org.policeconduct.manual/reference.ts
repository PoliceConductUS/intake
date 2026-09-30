// Resolving one reference in the interview (ADR 0031). The user supplies a value —
// by typing it or by searching and selecting a match — which the data context
// resolves to a namespace-local SOURCE ID (it maps the canonical id to this
// source's namespace via the ledger and returns the source id; a canonical id
// never leaves the data context, ADR 0023). If nothing resolves, or the user
// cancels, they choose a disposition: stop the acquire, skip this reference, or
// wait and retry (for when the target is not in intake yet).

export type Disposition = "stop" | "skip" | "wait";

export type ReferenceResult = { sourceId: string } | { skipped: true };

export type ReferenceIO = {
  /**
   * A resolved namespace-local source id for the reference (typed or
   * search-selected, resolved through the data context), or null when nothing
   * matched / the user cancelled.
   */
  getSourceId: () => Promise<string | null>;
  /** On no match / cancel: stop, skip, or wait-and-retry. */
  askDisposition: () => Promise<Disposition>;
  /** Pause (e.g. 5 minutes) before retrying. */
  wait: () => Promise<void>;
};

export async function resolveReference(
  io: ReferenceIO,
): Promise<ReferenceResult> {
  for (;;) {
    const sourceId = await io.getSourceId();
    if (sourceId !== null && sourceId.trim() !== "") {
      return { sourceId: sourceId.trim() };
    }
    const disposition = await io.askDisposition();
    if (disposition === "stop") {
      throw new Error(
        "org.policeconduct.manual: acquire stopped by the user at an unresolved reference.",
      );
    }
    if (disposition === "skip") {
      return { skipped: true };
    }
    // wait: pause, then loop to search/resolve again (the target may now exist).
    await io.wait();
  }
}
