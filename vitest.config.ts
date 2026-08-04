import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      TZ: "UTC"
    },
    include: [
      "packages/core/src/**/*.test.ts",
      "apps/api/test/**/*.test.mjs",
      "apps/web/src/lib/**/*.test.ts",
      "apps/extension/test/**/*.test.mjs"
    ]
  }
});
