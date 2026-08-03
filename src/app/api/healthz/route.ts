/**
 * Health check for deploy gates and uptime monitoring.
 *
 * Reports what is actually reachable and configured, not just that the process
 * is up — a 200 from a server with a dead database tells a deploy check nothing.
 *
 * Deliberately outside /api/v1: it must answer without a session, without the
 * gateway pipeline, and without touching the rate limiter (which writes to the
 * very database it is checking).
 */
import { NextResponse } from "next/server";
import { authProvider } from "@/lib/providers/auth/index.server";
import { paymentProvider } from "@/lib/providers/payments/index.server";
import { repo } from "@/lib/repositories";
import {
  checkConfiguration,
  fatalProblems,
} from "@/lib/config/preflight";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  const databaseReachable = await repo.health.ping();

  // Provider construction can throw by design (the mock providers refuse to
  // exist in production), and that is exactly the kind of misconfiguration a
  // health check should surface rather than crash on.
  let auth: { name: string; configured: boolean };
  try {
    const provider = authProvider();
    auth = { name: provider.name, configured: provider.isConfigured };
  } catch (err) {
    auth = { name: "misconfigured", configured: false };
    console.error("[healthz] auth provider unavailable:", err);
  }

  let payments: { name: string; configured: boolean };
  try {
    const provider = paymentProvider();
    payments = { name: provider.name, configured: provider.isConfigured };
  } catch (err) {
    payments = { name: "misconfigured", configured: false };
    console.error("[healthz] payment provider unavailable:", err);
  }

  // A reachable database is not the same as a deployable one: SQLite on
  // serverless answers this check happily right up until it loses the data.
  const configProblems = checkConfiguration();
  const fatal = fatalProblems(configProblems);

  const healthy = databaseReachable && auth.configured && fatal.length === 0;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: {
        database: databaseReachable ? "up" : "down",
        auth,
        payments,
        configuration:
          configProblems.length === 0
            ? "ok"
            : configProblems.map((p) => `${p.severity}: ${p.setting}`),
      },
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
