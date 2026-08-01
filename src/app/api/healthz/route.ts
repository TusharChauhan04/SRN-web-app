/**
 * Health check for deploy gates and uptime monitoring.
 *
 * Reports whether the placeholder database is actually reachable rather than
 * just that the process is up — a 200 from a Next.js server with a dead
 * database tells a deploy check nothing useful.
 */
import { NextResponse } from "next/server";
import { isAdminConfigured } from "@/lib/firebase/admin";
import { repo } from "@/lib/repositories";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  const databaseReachable = await repo.health.ping();

  const body = {
    status: databaseReachable ? "ok" : "degraded",
    checks: {
      database: databaseReachable ? "up" : "down",
      firebaseAdmin: isAdminConfigured ? "configured" : "missing",
    },
    latencyMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, { status: databaseReachable ? 200 : 503 });
}
