import { describe, expect, it } from "vitest";
import { checkConfiguration, fatalProblems } from "@/lib/config/preflight";

/**
 * These guard the checks that guard the deploy.
 *
 * Every case below describes a configuration that would look like a working
 * deployment and then lose data or authenticate the wrong person. The point of
 * the checks is that none of those fail loudly on their own.
 */

const productionBase = {
  NODE_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://srn.example",
  DATABASE_URL: "postgresql://user:pw@host:5432/srn",
  // Required for migrations. Its absence is a warning, so leaving it out here
  // would make the "fully configured" fixture report a problem.
  DIRECT_URL: "postgresql://user:pw@host:5432/srn",
  AUTH_PROVIDER: "firebase",
  PAYMENT_PROVIDER: "razorpay",
  OTP_PROVIDER: "sms",
  /*
   * `supabase`, not `firebase`. This fixture used to select Firebase Storage —
   * a stub whose four methods all throw — and the first test below asserts this
   * environment is fully deployable. The suite was certifying a configuration
   * that 500s on the first KYC upload as correct.
   */
  STORAGE_PROVIDER: "supabase",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_STORAGE_BUCKET: "uploads",
  STORAGE_SIGNING_SECRET: "a-real-secret",
  EMAIL_PROVIDER: "smtp",
} as NodeJS.ProcessEnv;

function fatalSettings(env: NodeJS.ProcessEnv): string[] {
  return fatalProblems(checkConfiguration(env)).map((p) => p.setting);
}

describe("production configuration", () => {
  it("accepts a fully configured production environment", () => {
    expect(checkConfiguration(productionBase)).toEqual([]);
  });

  it("rejects SQLite in production", () => {
    // The failure this prevents is silent: on serverless the filesystem is
    // ephemeral and per-instance, so rows vanish on cold start.
    expect(
      fatalSettings({ ...productionBase, DATABASE_URL: "file:./dev.db" }),
    ).toContain("DATABASE_URL");
  });

  it("rejects the transaction pooler without pgbouncer=true", () => {
    // Also silent, and worse than SQLite to diagnose: transaction-mode
    // PgBouncer cannot hold prepared statements, so Prisma fails only under
    // concurrency and looks like intermittent network trouble.
    expect(
      fatalSettings({
        ...productionBase,
        DATABASE_URL: "postgresql://user:pw@host:6543/postgres",
      }),
    ).toContain("DATABASE_URL");
  });

  it("detects a pooler on Azure's port and by hostname, not just Supabase's", () => {
    // Port alone is vendor-specific — Supabase uses 6543, Azure's built-in
    // PgBouncer uses 6432. Matching only 6543 would make this check go inert
    // on the planned move to Azure, which is a false negative: the misconfigured
    // URL passes preflight and fails later under load.
    expect(
      fatalSettings({
        ...productionBase,
        DATABASE_URL: "postgresql://user:pw@myserver.postgres.database.azure.com:6432/postgres",
      }),
    ).toContain("DATABASE_URL");

    expect(
      fatalSettings({
        ...productionBase,
        DATABASE_URL: "postgresql://user:pw@aws-0-ap-south-1.pooler.example.com:5432/postgres",
      }),
    ).toContain("DATABASE_URL");
  });

  it("accepts supabase storage when it is fully configured", () => {
    expect(
      checkConfiguration({
        ...productionBase,
        STORAGE_PROVIDER: "supabase",
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        SUPABASE_STORAGE_BUCKET: "uploads",
      }),
    ).toEqual([]);
  });

  it("rejects supabase storage selected without its credentials", () => {
    // Distinct from a misspelling: the value is correct, so the provider is
    // selected happily and then throws on the first upload — at which point the
    // failing thing is a user's KYC submission, not a deploy.
    const env: NodeJS.ProcessEnv = {
      ...productionBase,
      STORAGE_PROVIDER: "supabase",
    };
    // productionBase now carries them, so they have to be removed explicitly.
    delete env.SUPABASE_URL;
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    delete env.SUPABASE_STORAGE_BUCKET;

    expect(fatalSettings(env)).toContain("STORAGE_PROVIDER");
  });

  it("does not demand a local signing secret when storage is supabase", () => {
    // Supabase signs its own URLs, and every local storage route early-returns
    // unless the provider is `local`, so signStoragePath cannot run. Demanding
    // the secret anyway made preflight refuse a correct configuration.
    const env: NodeJS.ProcessEnv = {
      ...productionBase,
      STORAGE_PROVIDER: "supabase",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      SUPABASE_STORAGE_BUCKET: "uploads",
    };
    delete env.STORAGE_SIGNING_SECRET;

    expect(fatalSettings(env)).not.toContain("STORAGE_SIGNING_SECRET");
  });

  it("rejects firebase storage, which is still an unimplemented stub", () => {
    // This was the DOCUMENTED production value before Supabase Storage existed,
    // so a hosting environment may still carry it. It passed every check —
    // recognised name, so the local check did not fire; credential check only
    // covered supabase — and then threw on the first upload.
    expect(
      fatalSettings({ ...productionBase, STORAGE_PROVIDER: "firebase" }),
    ).toContain("STORAGE_PROVIDER");
  });

  it("treats an UNSET storage provider the way the factory does", () => {
    /*
     * preflight and the provider factory must agree. They did not: the factory
     * chose supabase in production for an unset value while preflight assumed
     * local, so preflight reported "KYC documents written to an ephemeral disk"
     * — false — and never ran the Supabase credential check for the one case
     * where Supabase is what gets selected.
     */
    const env: NodeJS.ProcessEnv = { ...productionBase };
    delete env.STORAGE_PROVIDER;
    delete env.SUPABASE_URL;

    const problems = checkConfiguration(env);
    const message = problems.find((p) => p.setting === "STORAGE_PROVIDER")
      ?.message;

    // It must complain about the MISSING SUPABASE CREDENTIALS, not about local
    // disk — the latter would be describing a provider that is not selected.
    expect(message).toBeDefined();
    expect(message).toContain("SUPABASE_URL");
    expect(message).not.toContain("ephemeral");
  });

  it("still rejects a misspelled storage provider", () => {
    // Adding 'supabase' to the known list must not widen what counts as valid.
    expect(
      fatalSettings({ ...productionBase, STORAGE_PROVIDER: "supabse" }),
    ).toContain("STORAGE_PROVIDER");
  });

  it("does not flag a plain direct connection as a pooler", () => {
    // The negative case: a check that flagged every Postgres URL would be
    // indistinguishable from one that works, and would train people to ignore it.
    expect(
      fatalSettings({
        ...productionBase,
        DATABASE_URL: "postgresql://user:pw@db.internal:5432/srn",
      }),
    ).not.toContain("DATABASE_URL");
  });

  it("accepts the transaction pooler when pgbouncer=true is present", () => {
    // The negative case matters as much as the positive one: a check that
    // flagged every :6543 URL would be indistinguishable from one that works,
    // and would train people to ignore it.
    expect(
      fatalSettings({
        ...productionBase,
        DATABASE_URL:
          "postgresql://user:pw@host:6543/postgres?pgbouncer=true&connection_limit=1",
      }),
    ).not.toContain("DATABASE_URL");
  });

  it("warns, but does not fail, when DIRECT_URL is missing", () => {
    // Deliberately not fatal: the running app never uses DIRECT_URL, only
    // `prisma migrate` does. A deploy without it serves traffic correctly and
    // fails at the next migration, which is worth saying but not worth
    // refusing the deploy over.
    const env = { ...productionBase };
    delete env.DIRECT_URL;

    const problems = checkConfiguration(env);
    expect(problems.map((p) => p.setting)).toContain("DIRECT_URL");
    expect(fatalProblems(problems).map((p) => p.setting)).not.toContain(
      "DIRECT_URL",
    );
  });

  it("rejects each development provider in production", () => {
    expect(
      fatalSettings({ ...productionBase, AUTH_PROVIDER: "mock" }),
    ).toContain("AUTH_PROVIDER");
    expect(
      fatalSettings({ ...productionBase, PAYMENT_PROVIDER: "mock" }),
    ).toContain("PAYMENT_PROVIDER");
    expect(
      fatalSettings({ ...productionBase, OTP_PROVIDER: "console" }),
    ).toContain("OTP_PROVIDER");
    expect(
      fatalSettings({ ...productionBase, STORAGE_PROVIDER: "local" }),
    ).toContain("STORAGE_PROVIDER");
  });

  it("rejects a MISSPELLED storage provider instead of silently using local disk", () => {
    // The check used to compare the raw string to "local", so `firebse` passed
    // preflight while the app ran on local disk and wrote KYC documents to it.
    expect(
      fatalSettings({ ...productionBase, STORAGE_PROVIDER: "firebse" }),
    ).toContain("STORAGE_PROVIDER");
    expect(
      fatalSettings({ ...productionBase, STORAGE_PROVIDER: "s3" }),
    ).toContain("STORAGE_PROVIDER");
  });

  it("rejects a missing storage signing secret when storage is LOCAL", () => {
    /*
     * Unset, every instance signs with its own random key: signed KYC links
     * minted by one instance are rejected by the next.
     *
     * Scoped to local storage. This test used to inherit productionBase's
     * `firebase` provider and still expect the fatal, which encoded the old
     * unconditional check — a check that became a false alarm once a backend
     * that signs its own URLs existed. The negative case is covered separately
     * below; keeping both is what stops the scoping from silently widening.
     */
    const env: NodeJS.ProcessEnv = {
      ...productionBase,
      STORAGE_PROVIDER: "local",
    };
    delete env.STORAGE_SIGNING_SECRET;
    expect(fatalSettings(env)).toContain("STORAGE_SIGNING_SECRET");
  });

  it("rejects a missing app URL, which disables the cross-origin check", () => {
    const env = { ...productionBase };
    delete env.NEXT_PUBLIC_APP_URL;
    expect(fatalSettings(env)).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("rejects the console email provider in production", () => {
    // Was a warning on the grounds that nobody loses data. That was wrong on
    // both counts: notification bodies carry personal data into the server log,
    // and the provider now refuses to construct in production — so shipping it
    // is a crash on the first notification, not a degraded feature.
    expect(
      fatalSettings({ ...productionBase, EMAIL_PROVIDER: "console" }),
    ).toContain("EMAIL_PROVIDER");
  });
});

describe("development configuration", () => {
  it("allows every development default outside production", () => {
    expect(
      checkConfiguration({
        NODE_ENV: "development",
        DATABASE_URL: "file:./dev.db",
        AUTH_PROVIDER: "mock",
        PAYMENT_PROVIDER: "mock",
        OTP_PROVIDER: "console",
        STORAGE_PROVIDER: "local",
        EMAIL_PROVIDER: "console",
      } as NodeJS.ProcessEnv),
    ).toEqual([]);
  });

  it("still requires a database URL", () => {
    expect(
      fatalSettings({ NODE_ENV: "development" } as NodeJS.ProcessEnv),
    ).toContain("DATABASE_URL");
  });
});
