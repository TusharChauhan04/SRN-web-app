import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Tests run against a REAL SQLite database, not mocks.
 *
 * The bugs worth catching in this codebase were all in the interaction between
 * layers — a race between two inserts, a webhook replay, an unanchored LIKE
 * matching across token boundaries. Mocking the repository would have hidden
 * every one of them.
 *
 * `tests/setup.ts` points DATABASE_URL at a scratch file and migrates it, so a
 * run never touches prisma/dev.db.
 */
export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Repository tests share one database file; running files in parallel
    // would have them deleting each other's rows.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws when imported outside a React Server Component.
      // Vitest is neither, so it is stubbed — the modules under test are
      // server modules by design.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
