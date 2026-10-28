import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration suites start disposable databases; bound resource contention.
    maxWorkers: 4,
    include: ["test/**/*.test.ts"],
  },
});
