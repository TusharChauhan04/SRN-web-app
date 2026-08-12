/**
 * Scheduled erasure of accounts whose deletion grace period has expired.
 *
 * This is the most destructive endpoint in the application: it permanently
 * anonymises user rows and deletes their stored files, including KYC identity
 * documents. Everything below is written on the assumption that it will one day
 * be found by someone who should not have it.
 *
 * It exists because `requestDeletion` recorded a date and nothing ever acted on
 * it — the app accepted "delete my data", showed the user when it would happen,
 * and then kept everything. Silently.
 *
 * Layering: this route imports the SERVICE only. Route handlers may not reach
 * the repository (eslint `api-routes`), and the grace-period rule belongs in the
 * service regardless.
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runDueErasures } from "@/lib/services/gdpr.service";

export const dynamic = "force-dynamic";

/** Bounds one run. Erasure cannot be undone; a bad cutoff should be survivable. */
const MAX_PER_RUN = 50;

/**
 * Constant-time bearer check.
 *
 * Refuses outright when CRON_SECRET is unset rather than defaulting to open —
 * an unauthenticated caller must never be able to trigger mass erasure, and a
 * missing variable is exactly how that happens by accident.
 */
function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request) {
  if (!authorised(req)) {
    // 404, not 401: an unauthenticated caller learns nothing about whether this
    // endpoint exists, matching the dev-credential route's reasoning.
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found" } },
      { status: 404 },
    );
  }

  try {
    const result = await runDueErasures(MAX_PER_RUN);

    // A partial failure is reported, not swallowed. eraseUserData leaves the
    // database intact when object deletion fails, so those accounts are simply
    // retried on the next run — but nobody learns that from a 200 with no body.
    const status = result.failed.length > 0 ? 207 : 200;
    if (result.failed.length > 0) {
      console.error("[cron/gdpr-erasure] partial failure", result.failed);
    }
    return NextResponse.json(result, { status });
  } catch (err) {
    console.error("[cron/gdpr-erasure] run failed", err);
    return NextResponse.json(
      { error: { code: "internal", message: "Erasure run failed" } },
      { status: 500 },
    );
  }
}

// Vercel Cron issues a GET. POST is accepted so the job can be triggered
// manually with curl without pretending to be the scheduler.
export const GET = handle;
export const POST = handle;
