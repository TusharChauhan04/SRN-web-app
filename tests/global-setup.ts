import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

/**
 * Creates a scratch database once per run and migrates it.
 *
 * Deliberately NOT prisma/dev.db — a test run must never be able to wipe the
 * database someone is developing against.
 */
const TEST_DB = path.join(process.cwd(), "prisma", "test.db");

export async function setup() {
  rmSync(TEST_DB, { force: true });
  rmSync(`${TEST_DB}-journal`, { force: true });

  execSync("pnpm exec prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "pipe",
  });
}

export async function teardown() {
  // Windows keeps a lock on the SQLite file until the connection is released,
  // and the worker may still be shutting down. A leftover scratch file is
  // harmless (gitignored, recreated next run) so this must not fail the suite.
  try {
    rmSync(TEST_DB, { force: true });
    rmSync(`${TEST_DB}-journal`, { force: true });
  } catch {
    // Deleted on the next run's setup instead.
  }
}
