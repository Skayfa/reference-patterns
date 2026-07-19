import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./global-setup.ts"],
    // The flow itself is fast; the timeout headroom is for slow machines.
    testTimeout: 30_000,
  },
});
