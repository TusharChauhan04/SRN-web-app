import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Tests run against a REAL Postgres database, not mocks.
 *
 * The bugs worth catching in this codebase were all in the interaction between
 * layers — a race between two inserts, a webhook replay, an unanchored LIKE
 * matching across token boundaries. Mocking the repository would have hidden
 * every one of them. That argument got stronger with Postgres, not weaker:
 * case-sensitive LIKE and timestamp binding are exactly the kind of thing only
 * a real engine tells you about.
 *
 * `tests/global-setup.ts` migrates a dedicated schema and refuses to touch
 * `public`; `tests/setup.ts` points every worker at it.
 */

/*
 * Load .env here, before anything else reads process.env.
 *
 * Vitest does not read .env by default — Vite only exposes VITE_-prefixed
 * variables to client code, and nothing loads it for the Node side. That was
 * invisible while tests hardcoded a SQLite path and needed no configuration at
 * all; the moment they needed TEST_DATABASE_URL, `pnpm test` failed with the
 * variable sitting right there in .env.
 *
 * This file runs in the parent process, so workers inherit what it loads —
 * which is why it belongs here rather than in global-setup (main process only)
 * or setup.ts (per worker, too late for globalSetup).
 *
 * Absence is not an error: CI sets these variables directly.
 */
if (!process.env.TEST_DATABASE_URL) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file. CI and any environment that exports the variables directly
    // are unaffected; global-setup fails with a precise message if it is
    // genuinely missing.
  }
}

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
