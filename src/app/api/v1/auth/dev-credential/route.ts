/**
 * Development-only credential minting.
 *
 * Exists so the app is fully usable before anyone has Firebase credentials.
 * It hands out a signed credential for any email address, which is exactly why
 * it refuses to respond unless the mock auth provider is selected AND we are
 * not in production. Both checks, deliberately — either alone is one
 * misconfiguration away from an open door.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { configuredAuthProviderName } from "@/lib/providers/auth/index.server";
import { issueMockCredential } from "@/lib/providers/auth/mock.server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().trim().email().max(160),
  signInProvider: z.enum(["password", "google.com"]).default("password"),
});

export async function POST(req: Request) {
  if (
    process.env.NODE_ENV === "production" ||
    configuredAuthProviderName() !== "mock"
  ) {
    // 404 rather than 403 — the endpoint should look like it does not exist.
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found" } },
      { status: 404 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_failed", message: "Enter a valid email" } },
      { status: 422 },
    );
  }

  return NextResponse.json({
    credential: issueMockCredential({
      email: parsed.data.email,
      // Mock accounts are always "verified" — there is no mailbox to check, and
      // leaving them unverified would just block the sign-in gate permanently.
      emailVerified: true,
      signInProvider: parsed.data.signInProvider,
    }),
    emailVerified: true,
  });
}
