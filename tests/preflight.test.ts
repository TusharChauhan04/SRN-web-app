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
  AUTH_PROVIDER: "firebase",
  PAYMENT_PROVIDER: "razorpay",
  OTP_PROVIDER: "sms",
  STORAGE_PROVIDER: "firebase",
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

  it("rejects a missing app URL, which disables the cross-origin check", () => {
    const env = { ...productionBase };
    delete env.NEXT_PUBLIC_APP_URL;
    expect(fatalSettings(env)).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("treats a missing email provider as a warning, not fatal", () => {
    // Nobody loses data; a toggle just does not deliver. Worth saying, not
    // worth blocking a deploy over.
    const problems = checkConfiguration({
      ...productionBase,
      EMAIL_PROVIDER: "console",
    });
    expect(problems.map((p) => p.setting)).toContain("EMAIL_PROVIDER");
    expect(fatalProblems(problems)).toEqual([]);
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
