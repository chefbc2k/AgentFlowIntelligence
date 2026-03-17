import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/ui/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./tests/ui/setup.ts"],
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text"],
      reportsDirectory: "coverage/ui",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 100,
      },
    },
  },
});
