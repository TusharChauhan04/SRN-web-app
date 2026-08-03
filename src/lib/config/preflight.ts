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
   * Check the RESOLVED provider, not the raw string.
   *
   * This used to compare `env.STORAGE_PROVIDER ?? "local"` against "local",
   * which passed for any unrecognised value — so `STORAGE_PROVIDER=firebse`
   * reported "configuration looks deployable" while the app ran on local disk.
   * Note this deliberately does NOT mirror the factory exactly: for an unknown
   * value the factory resolves to "firebase" (so it fails loudly on a missing
   * bucket), while preflight treats unknown as unusable and reports it. Both
   * fail closed; they just say so differently. What matters is that neither
   * path can quietly end up on local disk.
   */
  const storage = (env.STORAGE_PROVIDER ?? "").toLowerCase();
  const resolvedStorage = storage === "firebase" ? "firebase" : "local";
  if (isProduction && resolvedStorage === "local") {
    problems.push({
      severity: "fatal",
      setting: "STORAGE_PROVIDER",
      message:
        storage && storage !== "local"
          ? `Unrecognised value "${env.STORAGE_PROVIDER}" — the only supported ` +
            "values are 'local' and 'firebase'. Check the spelling."
          : "Local file storage in production. Uploads — including KYC identity " +
            "documents — are written to an ephemeral per-instance disk and lost.",
    });
  }

  if (isProduction && !env.STORAGE_SIGNING_SECRET) {
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
