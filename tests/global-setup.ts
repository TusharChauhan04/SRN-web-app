import { execSync } from "node:child_process";

/**
 * Prepares an isolated Postgres schema and migrates it, once per run.
 *
 * This replaces a scratch SQLite file, and it does NOT fully replace what that
 * file guaranteed. Be precise about the difference:
 *
 *   SQLite gave isolation by construction — a separate file cannot reach
 *   another file. What the checks below give is SCHEMA isolation only. They
 *   verify the target namespace, never the host, port or database, so a
 *   TEST_DATABASE_URL aimed at production with ?schema=srn_test passes and then
 *   drops that schema there. Same server, different namespace.
 *
 * That is a deliberate limit, not an oversight: the URL alone cannot tell a
 * development instance from a production one. Point this at a database you are
 * willing to lose a schema from.
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

  let schemas: string[];
  try {
    schemas = new URL(url).searchParams.getAll(REQUIRED_SCHEMA_PARAM);
  } catch {
    throw new Error(`TEST_DATABASE_URL is not a valid URL.`);
  }

  /*
   * `getAll`, not `get`, and exactly one is required.
   *
   * `?schema=srn_test&schema=public` is the dangerous shape: JavaScript's
   * searchParams.get() returns the FIRST value, while the connection string
   * parser Prisma hands the URL to takes the LAST. The guard would approve
   * `srn_test` and the reset would drop `public`. Validating with one parser
   * and destroying with another only works while they happen to agree, so
   * refuse the ambiguity outright rather than trying to predict it.
   */
  if (schemas.length > 1) {
    throw new Error(
      `TEST_DATABASE_URL specifies ?schema= ${schemas.length} times ` +
        `(${schemas.join(", ")}).\n\n` +
        "This is refused rather than resolved: JavaScript reads the first " +
        "value and the database connector reads the last, so the schema this " +
        "check approves need not be the one that gets dropped. Use exactly one.",
    );
  }

  // Trimmed and case-folded before comparison. Postgres quotes the identifier,
  // so "PUBLIC" would not actually hit `public` — it would silently create a
  // second schema — but a guard that says it blocks `public` should block
  // every spelling of it rather than merely the lowercase one.
  const schema = schemas[0]?.trim().toLowerCase() ?? null;

  /*
   * These two checks are the whole safety story.
   *
   * Note WHERE the danger is, because it is not in this file. Setup itself is
   * now additive — CREATE SCHEMA IF NOT EXISTS, then `migrate deploy`, neither
   * of which can drop anything. The destruction is in the SUITE: `wipe()` in
   * tests/regressions.test.ts runs `deleteMany()` across every table in
   * beforeEach, before each of dozens of tests.
   *
   * So the guard is not protecting against a reset. It is protecting against
   * the tests being pointed at the application's own schema and quietly
   * emptying it, one beforeEach at a time. Without `?schema=`, Postgres
   * defaults to `public` — which is exactly where the app's data lives. One
   * missing query parameter, no error, no warning. Fail closed.
   */
  if (!schema) {
    throw new Error(
      "TEST_DATABASE_URL has no ?schema= parameter.\n\n" +
        "Postgres would default to `public` — the schema the application uses — " +
        "and the suite deletes every row in every table before each test.\n" +
        "Append ?schema=srn_test (or another dedicated name).",
    );
  }

  if (schema === "public") {
    throw new Error(
      "TEST_DATABASE_URL points at the `public` schema.\n\n" +
        "The suite empties every table before each test, and `public` is where " +
        "the application's data lives.\n" +
        "That is the application's own data, and this setup drops every table " +
        "in the target schema. Use a dedicated schema such as ?schema=srn_test.",
    );
  }

  return url;
}

export async function setup() {
  const url = resolveTestDatabaseUrl();
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };

  /*
   * `migrate deploy`, NOT `migrate reset`. This is deliberate and worth keeping.
   *
   * The SQLite version deleted a scratch file and then deployed. Translating
   * "delete the file" into "drop the schema" looks equivalent and is not: reset
   * is irreversible, needs --force to skip its own confirmation, and would run
   * on every `pnpm test`. Deploy only ever CREATES — it can add tables, never
   * drop them or the rows in them.
   *
   * Emptying between runs is already handled where it belongs: `wipe()` in
   * tests/regressions.test.ts runs in beforeEach and clears every table. Setup
   * does not need to destroy anything to give the suite a clean slate, so it
   * doesn't.
   *
   * Consequence to know: deploy will FAIL rather than silently repair if the
   * schema has drifted from the migrations. That is the right failure — it asks
   * a human to look instead of quietly discarding data.
   */
  // Postgres will not create a schema implicitly, and the migration no longer
  // carries a CREATE SCHEMA line (it hardcoded "public", which was wrong).
  // IF NOT EXISTS makes this idempotent and additive — it cannot drop anything.
  execSync(`pnpm exec prisma db execute --url "${url}" --stdin`, {
    env,
    input: `CREATE SCHEMA IF NOT EXISTS "${schemaNameOf(url)}";`,
    stdio: ["pipe", "inherit", "inherit"],
  });

  // `inherit`: setup can fail for several configuration reasons, and piping
  // reduces all of them to "Command failed" with Prisma's diagnosis discarded.
  execSync("pnpm exec prisma migrate deploy", { env, stdio: "inherit" });
}

/** The validated schema name, re-read from the URL the guards approved. */
function schemaNameOf(url: string): string {
  return new URL(url).searchParams.get(REQUIRED_SCHEMA_PARAM)!.trim();
}

export async function teardown() {
  // Nothing to clean up: the schema is reset at the start of the next run, and
  // leaving it populated makes a failed run easier to inspect.
}
