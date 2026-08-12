/*
 * Deliberately NOT marked `server-only`, unlike the rest of src/lib.
 *
 * `scripts/preflight.ts` runs this from plain Node to gate a deploy, and
 * `server-only` does not resolve outside Next's bundler. That is safe here in a
 * way it would not be for the data layer: this module reads environment
 * variables and returns descriptions of what is wrong with them. It holds no
 * secrets, opens no connections, and imports nothing.
 */

/**
 * Production configuration checks.
 *
 * These exist because the dangerous failures in this app are all SILENT:
 *
 *  - SQLite on serverless writes to an ephemeral disk. Nothing errors. Data
 *    just disappears on the next cold start, and is not shared between
 *    instances in the meantime.
 *  - A missing NEXT_PUBLIC_APP_URL disables the cross-origin check that stops
 *    login CSRF.
 *  - Local file storage on serverless loses every upload the same way SQLite
 *    loses every row — including identity documents.
 *
 * Each would look like a working deployment for a while. Better to refuse to
 * start, or at minimum to say so loudly, than to lose someone's data quietly.
 */

export interface ConfigProblem {
  severity: "fatal" | "warning";
  setting: string;
  message: string;
}

/**
 * Inspects the environment and reports what is wrong with it.
 *
 * Pure and side-effect free so it can be called from a health check, a preflight
 * script, or a test without starting anything.
 */
export function checkConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const isProduction = env.NODE_ENV === "production";

  const databaseUrl = env.DATABASE_URL ?? "";
  if (!databaseUrl) {
    problems.push({
      severity: "fatal",
      setting: "DATABASE_URL",
      message: "Not set. The app cannot reach a database.",
    });
  } else if (isProduction && databaseUrl.startsWith("file:")) {
    problems.push({
      severity: "fatal",
      setting: "DATABASE_URL",
      message:
        "SQLite in production. On serverless hosting the filesystem is " +
        "ephemeral and per-instance: rows are lost on cold start and are not " +
        "shared between instances. This fails silently, which is why it is " +
        "treated as fatal. Move to hosted Postgres (DATABASE.md §3, Case A) " +
        "or deploy somewhere with a persistent disk.",
    });
  }

  /*
   * A pooled connection string without `pgbouncer=true`.
   *
   * Fatal, and it belongs here precisely because of how it fails: transaction
   * -mode PgBouncer cannot hold prepared statements across a connection, and
   * without the flag Prisma emits them anyway. One user never sees it. It
   * appears under concurrency, as intermittent query errors that look like
   * network flakiness — the exact silent-failure shape this module exists for.
   *
   * Detected by port OR by a pooler-shaped host, because port alone is
   * vendor-specific: Supabase's transaction pooler is 6543 and Azure Database
   * for PostgreSQL's built-in PgBouncer is 6432. Matching only 6543 would make
   * this check go silently inert on the move to Azure — a FALSE NEGATIVE, which
   * is worse than no check at all: a pooled Azure URL missing the flag would
   * pass preflight and then fail intermittently under load, which is precisely
   * what this exists to prevent.
   */
  const looksPooled =
    databaseUrl.includes(":6543") || // Supabase transaction pooler
    databaseUrl.includes(":6432") || // Azure / standard PgBouncer
    /[/@][^/@]*pooler[^/@]*/.test(databaseUrl); // hostname says so
  if (looksPooled && !databaseUrl.includes("pgbouncer=true")) {
    problems.push({
      severity: "fatal",
      setting: "DATABASE_URL",
      message:
        "Points at a transaction pooler without ?pgbouncer=true. Prisma will " +
        "emit prepared statements the pooler cannot hold, which fails " +
        "intermittently under concurrent load and not at all in testing. " +
        "Append ?pgbouncer=true (and &connection_limit=1 on serverless).",
    });
  }

  /*
   * DIRECT_URL is a WARNING, not fatal, and the distinction is deliberate.
   *
   * A running app never uses it — only `prisma migrate` does. So a deployment
   * missing it serves traffic perfectly and then fails the next time anyone
   * tries to apply a migration, which is a bad moment to discover a missing
   * variable but not a reason to refuse the deploy.
   */
  if (databaseUrl.startsWith("postgres") && !env.DIRECT_URL) {
    problems.push({
      severity: "warning",
      setting: "DIRECT_URL",
      message:
        "Not set. The app will run without it, but `prisma migrate` fails with " +
        "P1012 — so migrations cannot be applied against this environment.",
    });
  }

  if (isProduction && !env.NEXT_PUBLIC_APP_URL) {
    problems.push({
      severity: "fatal",
      setting: "NEXT_PUBLIC_APP_URL",
      message:
        "Not set. The gateway's cross-origin check cannot run without a known " +
        "origin, and share links and payment webhooks build absolute URLs from it.",
    });
  }

  // The mock providers refuse to construct in production, but a clear message
  // here beats a stack trace on the first request.
  const mocksInProduction: [string, string | undefined, string][] = [
    ["AUTH_PROVIDER", env.AUTH_PROVIDER, "authenticates anyone as anyone"],
    ["PAYMENT_PROVIDER", env.PAYMENT_PROVIDER, "grants paid plans for free"],
    ["OTP_PROVIDER", env.OTP_PROVIDER, "reveals the verification code"],
  ];
  for (const [setting, value, consequence] of mocksInProduction) {
    if (isProduction && (value === "mock" || value === "console")) {
      problems.push({
        severity: "fatal",
        setting,
        message: `Development provider in production — it ${consequence}.`,
      });
    }
  }

  /*
   * Resolve EXACTLY as src/lib/providers/storage/index.server.ts does.
   *
   * These two used to disagree about an unset or unknown value: the factory
   * chose "supabase" in production while this file assumed "local". So with
   * STORAGE_PROVIDER unset, preflight reported "Local file storage in
   * production — KYC identity documents written to an ephemeral disk", which
   * was simply false, and sent anyone debugging it in the wrong direction. It
   * also meant the Supabase credential check below never ran for the one case
   * where Supabase is what actually gets selected.
   */
  const storage = (env.STORAGE_PROVIDER ?? "").toLowerCase();
  const recognised =
    storage === "supabase" || storage === "firebase" || storage === "local";
  const resolvedStorage = recognised
    ? storage
    : isProduction
      ? "supabase"
      : "local";

  /*
   * A misspelling is its own fatal, checked BEFORE resolution and independently
   * of it.
   *
   * Folding this into the resolution is a trap I walked into: once an unknown
   * value resolves to "supabase", a typo like `supabse` in an environment that
   * happens to hold valid Supabase credentials produces no complaint at all —
   * quieter than the behaviour it replaced. The operator asked for something
   * that does not exist, and that is worth saying out loud regardless of what
   * the fallback happens to pick.
   */
  if (isProduction && storage && !recognised) {
    problems.push({
      severity: "fatal",
      setting: "STORAGE_PROVIDER",
      message:
        `Unrecognised value "${env.STORAGE_PROVIDER}" — supported values are ` +
        "'local', 'supabase' and 'firebase'. Check the spelling.",
    });
  }

  /*
   * Firebase Storage is FATAL while it remains a stub.
   *
   * Every one of its four methods throws `storage/not-implemented`. It used to
   * pass every check here — it is a recognised name, so the local check did not
   * fire, and the credential check only covered supabase — so a deploy carrying
   * the previously-documented STORAGE_PROVIDER=firebase went green and then 500d
   * on the first KYC upload and on every avatar read.
   */
  if (isProduction && resolvedStorage === "firebase") {
    problems.push({
      severity: "fatal",
      setting: "STORAGE_PROVIDER",
      message:
        "FirebaseStorageProvider is not implemented — every method throws. " +
        "This was the documented production value before Supabase Storage " +
        "existed, so it may be left over in your hosting environment. Set " +
        "STORAGE_PROVIDER=supabase.",
    });
  }
  // Only reachable now by asking for `local` explicitly — an unrecognised value
  // is caught above and no longer resolves here, so this message can say the
  // one thing it means.
  if (isProduction && resolvedStorage === "local") {
    problems.push({
      severity: "fatal",
      setting: "STORAGE_PROVIDER",
      message:
        "Local file storage in production. Uploads — including KYC identity " +
        "documents — are written to an ephemeral per-instance disk and lost.",
    });
  }

  /*
   * A selected provider with no credentials is its own failure, and a distinct
   * one: the value is spelled correctly, so the check above passes, and the app
   * then throws on the first upload rather than at deploy time.
   */
  if (isProduction && resolvedStorage === "supabase") {
    // BOTH buckets. A single bucket has no correct setting: private breaks
    // every avatar, public exposes every KYC document. See the provider.
    const missing = [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_STORAGE_BUCKET",
      "SUPABASE_STORAGE_BUCKET_PUBLIC",
    ].filter((k) => !env[k]);

    if (missing.length > 0) {
      problems.push({
        severity: "fatal",
        setting: "STORAGE_PROVIDER",
        message:
          `STORAGE_PROVIDER=supabase but ${missing.join(", ")} ` +
          `${missing.length === 1 ? "is" : "are"} unset. Uploads and every KYC ` +
          "document read would throw on first use.",
      });
    }
  }

  /*
   * Only the LOCAL provider signs its own URLs, so only it needs this secret.
   *
   * It used to be demanded unconditionally in production, which became a false
   * fatal the moment a real storage backend existed: Supabase signs its own
   * URLs, and all three local storage routes early-return unless the provider
   * is `local`, so `signStoragePath` cannot execute. Preflight was refusing a
   * correct configuration over a secret nothing would read — and a check that
   * cannot be satisfied meaningfully is one people learn to ignore, which costs
   * far more than it saves.
   *
   * Nothing is weakened: running local storage in production is already fatal
   * above, for the stronger reason that the files do not survive a deploy.
   */
  if (isProduction && resolvedStorage === "local" && !env.STORAGE_SIGNING_SECRET) {
    problems.push({
      severity: "fatal",
      setting: "STORAGE_SIGNING_SECRET",
      message:
        "Unset. Signed URLs for KYC documents would be signed with a random " +
        "per-process key, so a link minted by one instance is rejected by the " +
        "next — and every outstanding link dies on each deploy.",
    });
  }

  if (isProduction && (env.EMAIL_PROVIDER ?? "console") === "console") {
    problems.push({
      // Fatal, not a warning: the console provider now REFUSES to construct in
      // production, so this would be a runtime crash on the first notification
      // rather than a degraded feature. Preflight should say so before deploy.
      severity: "fatal",
      setting: "EMAIL_PROVIDER",
      message:
        "Email would be logged, not sent — and notification bodies carry " +
        "personal data into the server log. The console provider refuses to " +
        "run in production; configure a real mail vendor.",
    });
  }

  const proxyCount = Number(env.TRUSTED_PROXY_COUNT ?? 1);
  if (!Number.isInteger(proxyCount) || proxyCount < 0) {
    problems.push({
      severity: "warning",
      setting: "TRUSTED_PROXY_COUNT",
      message:
        "Not a non-negative integer. Rate limiting derives the client IP from " +
        "this; a wrong value can make limits bypassable with a header.",
    });
  }

  return problems;
}

export function fatalProblems(problems: ConfigProblem[]): ConfigProblem[] {
  return problems.filter((p) => p.severity === "fatal");
}
