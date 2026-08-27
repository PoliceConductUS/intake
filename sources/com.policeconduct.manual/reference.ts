// Resolving one reference in the interview (ADR 0031). The user supplies a value —
// by typing it or by searching and selecting a match — which is resolved to a
// canonical id (via the ledger / DB). If nothing resolves, or the user cancels,
// they choose a disposition: stop the acquire, skip this reference, or wait and
// retry (for when the target is not in intake yet).

export type Disposition = "stop" | "skip" | "wait";

export type ReferenceResult = { canonicalId: string } | { skipped: true };

export type ReferenceIO = {
  /** Get a candidate value (typed or search-selected), or null to cancel. */
  askValue: () => Promise<string | null>;
  /** Resolve a value to a canonical id, or undefined if intake does not know it. */
  resolve: (value: string) => Promise<string | undefined>;
  /** On no resolution / cancel: stop, skip, or wait-and-retry. */
  askDisposition: () => Promise<Disposition>;
  /** Pause (e.g. 5 minutes) before retrying. */
  wait: () => Promise<void>;
};

export async function resolveReference(
  io: ReferenceIO,
): Promise<ReferenceResult> {
  for (;;) {
    const value = await io.askValue();
    if (value !== null && value.trim() !== "") {
      const canonicalId = await io.resolve(value.trim());
      if (canonicalId !== undefined) {
        return { canonicalId };
      }
    }
    // Nothing resolved (unknown value, or the user cancelled) — decide what next.
    const disposition = await io.askDisposition();
    if (disposition === "stop") {
      throw new Error(
        "com.policeconduct.manual: acquire stopped by the user at an unresolved reference.",
      );
    }
    if (disposition === "skip") {
      return { skipped: true };
    }
    // wait: pause, then loop to search/resolve again (the target may now exist).
    await io.wait();
  }
}
