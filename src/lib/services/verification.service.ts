import "server-only";

/**
 * Phone verification and KYC document submission.
 *
 * Both are the user-facing half of things the admin panel already reviews —
 * without this, the KYC queue could only ever be populated by the seed script.
 */
import { repo } from "@/lib/repositories";
import { RepositoryConflictError } from "@/lib/repositories/authorize";
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  generateOtp,
  hashOtp,
  otpProvider,
  verifyOtpHash,
} from "@/lib/providers/otp/index.server";
import type { User, VerificationRequest } from "@/lib/repositories/types";
import { GatewayError } from "@/lib/gateway/types";

// ─────────────────────────── Phone ───────────────────────────

/**
 * E.164-ish. Deliberately permissive on format but strict on length, since the
 * app is India-first and a stricter pattern would reject valid numbers from
 * anywhere else.
 */
const PHONE_PATTERN = /^\+?[1-9]\d{7,14}$/;

export interface PhoneChallengeStarted {
  phone: string;
  expiresAt: Date;
  /** Only ever set by the development provider. Never populated in production. */
  devHint?: string;
}

export async function startPhoneVerification(
  actor: User,
  rawPhone: string,
): Promise<PhoneChallengeStarted> {
  const phone = rawPhone.replace(/[\s()-]/g, "");
  if (!PHONE_PATTERN.test(phone)) {
    throw GatewayError.validation("Enter a valid phone number.");
  }

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  // Stored hashed and salted with the phone; the plaintext exists only long
  // enough to hand to the provider.
  await repo.phoneVerification.start({
    userId: actor.id,
    phone,
    codeHash: hashOtp(phone, code),
    expiresAt,
  });

  const { devHint } = await otpProvider().send(phone, code);

  return { phone, expiresAt, devHint };
}

export async function confirmPhoneVerification(
  actor: User,
  code: string,
): Promise<User> {
  const challenge = await repo.phoneVerification.find(actor.id);
  if (!challenge) {
    throw GatewayError.validation("Request a code first.");
  }

  if (challenge.expiresAt.getTime() < Date.now()) {
    await repo.phoneVerification.clear(actor.id);
    throw GatewayError.validation("That code expired. Request a new one.");
  }

  // Count the attempt BEFORE comparing, so a failure can't be retried for free
  // by aborting the request mid-flight.
  const attempts = await repo.phoneVerification.recordAttempt(actor.id);
  if (attempts > OTP_MAX_ATTEMPTS) {
    await repo.phoneVerification.clear(actor.id);
    throw GatewayError.validation(
      "Too many incorrect attempts. Request a new code.",
    );
  }

  if (!verifyOtpHash(challenge.phone, code.trim(), challenge.codeHash)) {
    throw GatewayError.validation("That code isn't right.");
  }

  await repo.phoneVerification.clear(actor.id);

  let updated;
  try {
    updated = await repo.users.update(actor.id, {
      phone: challenge.phone,
      phoneVerified: true,
    });
  } catch (err) {
    /*
     * One phone number, one account.
     *
     * Deliberately checked HERE and not before the SMS is sent. An
     * up-front check would answer "is this number registered?" to anyone who
     * typed one in, which is a free account-enumeration oracle. Failing at
     * confirmation costs one SMS and only tells someone who has already proven
     * control of the number.
     */
    if (err instanceof RepositoryConflictError) {
      throw GatewayError.conflict(err.message);
    }
    throw err;
  }

  await repo.audit
    .record({ actorId: actor.id, action: "phone.verified", target: actor.id })
    .catch(() => {});

  return updated;
}

// ─────────────────────────── KYC ───────────────────────────

export type KycDocType = "aadhaar" | "pan" | "gst" | "license" | "other";

export interface KycStatusView {
  latest: VerificationRequest | null;
  isVerified: boolean;
  canSubmit: boolean;
}

export async function getMyKycStatus(actor: User): Promise<KycStatusView> {
  const latest = await repo.verification.findLatestForUser(actor.id);

  return {
    latest,
    isVerified: actor.isVerified,
    // Blocked only while a submission is actually pending — a rejection must
    // be re-submittable, or a fixable mistake locks the account out forever.
    canSubmit: latest?.status !== "pending",
  };
}

export async function submitKyc(
  actor: User,
  input: { docType: KycDocType; uploadIds: string[] },
): Promise<VerificationRequest> {
  if (input.uploadIds.length === 0) {
    throw GatewayError.validation("Attach at least one document.");
  }

  const existing = await repo.verification.findLatestForUser(actor.id);
  if (existing?.status === "pending") {
    throw GatewayError.conflict(
      "You already have documents under review. Wait for that to finish.",
    );
  }

  // Resolve uploads to storage keys, verifying each belongs to THIS user — an
  // id from someone else's upload would otherwise attach their document.
  const uploads = await Promise.all(
    input.uploadIds.map((id) => repo.uploads.findById(id)),
  );

  const keys: string[] = [];
  for (const upload of uploads) {
    if (!upload || upload.userId !== actor.id) {
      throw GatewayError.validation("One of those files isn't available.");
    }
    if (upload.context !== "document") {
      throw GatewayError.validation("Those files aren't identity documents.");
    }
    if (!upload.confirmed) {
      throw GatewayError.validation("One of those uploads didn't finish.");
    }
    // The KEY, not the URL — read URLs are short-lived and signed, so storing
    // one would leave a dead link the moment it expired.
    keys.push(upload.storageKey);
  }

  const request = await repo.verification.create({
    userId: actor.id,
    docType: input.docType,
    docUrls: keys,
  });

  await repo.audit
    .record({
      actorId: actor.id,
      action: "verification.submitted",
      target: request.id,
      metadata: { docType: input.docType, fileCount: keys.length },
    })
    .catch(() => {});

  return request;
}
