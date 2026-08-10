import { execSync } from "node:child_process";

/**
 * Prepares an isolated Postgres schema and migrates it, once per run.
 *
 * This replaces a scratch SQLite file. The property that file gave us for free
 * — a test run cannot possibly touch the database you are developing against —
 * has to be enforced deliberately now that tests share a server with the app,
 * so it is checked below rather than assumed.
 *
 * Set TEST_DATABASE_URL to your DIRECT (session-mode, :5432) connection string
 * with a dedicated schema:
 *
 *   TEST_DATABASE_URL="postgresql://…@…:5432/postgres?schema=srn_test"
 *
 * The direct URL, not the pooled one: `prisma migrate` takes advisory locks and
 * runs DDL in a session that transaction-mode pooling breaks.
 */
const REQUIRED_SCHEMA_PARAM = "schema";

function resolveTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;

  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set.\n\n" +
        "The test suite needs its own Postgres schema. Use the DIRECT (:5432) " +
        "connection string with a dedicated schema:\n\n" +
        '  TEST_DATABASE_URL="postgresql://…@…:5432/postgres?schema=srn_test"\n\n' +
        "This is a change from the SQLite era, where a scratch file needed no " +
        "configuration. See tests/global-setup.ts.",
    );
  }

  let schema: string | null;
  try {
    schema = new URL(url).searchParams.get(REQUIRED_SCHEMA_PARAM);
  } catch {
    throw new Error(`TEST_DATABASE_URL is not a valid URL.`);
  }

  /*
   * These two checks are the whole safety story, and they exist because the
   * step below is `migrate reset` — it DROPS EVERY TABLE in the schema it is
   * pointed at.
   *
   * Without `?schema=`, Postgres defaults to `public`, which is where the
   * application's own data lives. A single missing query parameter would turn
   * `pnpm test` into a command that wipes your development database, with no
   * error and no warning. Fail closed instead.
   */
  if (!schema) {
    throw new Error(
      "TEST_DATABASE_URL has no ?schema= parameter.\n\n" +
        "Postgres would default to `public` — the schema the application uses — " +
        "and this setup runs `migrate reset`, which drops every table in it.\n" +
        "Append ?schema=srn_test (or another dedicated name).",
    );
  }

  if (schema === "public") {
    throw new Error(
      "TEST_DATABASE_URL points at the `public` schema.\n\n" +
        "That is the application's own data, and this setup drops every table " +
        "in the target schema. Use a dedicated schema such as ?schema=srn_test.",
    );
  }

  return url;
}

export async function setup() {
  const url = resolveTestDatabaseUrl();

  // `reset` rather than `deploy`: the schema persists between runs now that it
  // is not a file we can delete, so it has to be emptied explicitly.
  // --skip-seed because the suite builds its own fixtures and prisma/seed.ts is
  // development sample data.
  execSync("pnpm exec prisma migrate reset --force --skip-seed --skip-generate", {
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: "pipe",
  });
}

export async function teardown() {
  // Nothing to clean up: the schema is reset at the start of the next run, and
  // leaving it populated makes a failed run easier to inspect.
}
