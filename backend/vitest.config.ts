import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/globalSetup.ts"],
    setupFiles: ["./tests/setupEnv.ts"],
    fileParallelism: false, // tests share one PostgreSQL test database
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
