import { describe, expect, it } from "vitest";
import { pageKey } from "../../../sources/com/serpapi/landing-page-search/storage.js";

describe("deployment folder paths", () => {
  it("keeps public build and override paths aligned with the website and data private", () => {
    expect(pageKey("prod-temp", "build", "/personnel/example/")).toBe(
      "prod-temp/build/personnel/example/index.html",
    );
    expect(pageKey("prod-temp", "override", "/personnel/example/")).toBe(
      "prod-temp/override/personnel/example/index.html",
    );
    expect(pageKey("prod-temp", "data", "/personnel/example/")).toBe(
      "builds/prod-temp/data/personnel/example/index.json",
    );
    expect(pageKey("release 1", "build", "/")).toBe(
      "release 1/build/index.html",
    );
  });
  it.each(["", ".", "..", "../prod", "a/b", "a\\b", "a\n"])(
    "rejects unsafe folder %j",
    (folder) => {
      expect(() => pageKey(folder, "build", "/")).toThrow("Invalid release");
    },
  );
});
