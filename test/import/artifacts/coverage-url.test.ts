import { describe, it, expect } from "vitest";
import { normalizeCoverageUrl } from "../../../src/cli/import/artifacts/facades/coverage-resolvers.js";

describe("normalizeCoverageUrl", () => {
  it("collapses every YouTube form to the canonical long watch URL", () => {
    const canonical = "https://www.youtube.com/watch?v=abc123";
    for (const variant of [
      "https://www.youtube.com/watch?v=abc123",
      "https://youtube.com/watch?v=abc123&t=42s",
      "https://m.youtube.com/watch?v=abc123&list=PL9",
      "https://youtu.be/abc123",
      "https://www.youtube.com/shorts/abc123",
      "https://www.youtube.com/embed/abc123",
    ]) {
      expect(normalizeCoverageUrl(variant)).toBe(canonical);
    }
  });

  it("two YouTube variants of the same video share one identity", () => {
    expect(normalizeCoverageUrl("https://youtu.be/xyz?si=track")).toBe(
      normalizeCoverageUrl("https://www.youtube.com/watch?v=xyz&t=10"),
    );
  });

  it("normalizes a generic URL: https, no www, no trailing slash, sorted params, tracking dropped", () => {
    expect(
      normalizeCoverageUrl(
        "http://WWW.Example.com/News/Story/?utm_source=t&b=2&a=1",
      ),
    ).toBe("https://example.com/News/Story?a=1&b=2");
  });

  it("is idempotent", () => {
    const once = normalizeCoverageUrl("https://youtu.be/abc123?t=5");
    expect(normalizeCoverageUrl(once)).toBe(once);
  });
});
