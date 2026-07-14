import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // globals gives Testing Library a global afterEach to register its
    // auto-cleanup on; tests still import from "vitest" explicitly.
    globals: true,
    setupFiles: ["tests/setup.ts"],
  },
});
