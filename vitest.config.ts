import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["json"],
      reportsDirectory: "coverage/server",
      include: ["server/**/*.ts"],
      exclude: ["server/**/*.d.ts", "server/cli.ts"],
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 100,
      },
    },
  },
});
