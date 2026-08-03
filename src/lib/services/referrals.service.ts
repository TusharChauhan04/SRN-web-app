import "server-only";

/**
 * Referral policy.
 *
 * These rules used to live inside `PrismaReferralRepository.applyCode`, below
 * the swap boundary, communicated as plain `Error` message strings that the
 * gateway caught and showed to the user verbatim. That meant a new database
 * implementation had to re-derive four anti-fraud rules and reproduce four
 * exact English sentences — and if it didn't, the guards would disappear with
 * no type error and no failing test. Anti-fraud rules are the last thing that
 * should depend on someone reading the old implementation carefully.
 *
 * The repository now does one mechanical thing: claim the referral and pay the
 * reward atomically. Everything a human decided lives here.
 */
import { repo } from "@/lib/repositories";
import { RepositoryConflictError } from "@/lib/repositories/authorize";
import { GatewayError } from "@/lib/gateway/types";
import type { Referral, User } from "@/lib/repositories/types";

/**
 * Points credited to the referrer per successful signup.
 *
 * A product decision, not a storage one — which is why it is passed into the
 * repository rather than hard-coded there.
 */
export const REFERRAL_REWARD_POINTS = 100;

export async function applyReferralCode(
  actor: User,
  code: string,
): Promise<Referral> {
  const owner = await repo.referrals.findByCode(code.trim().toUpperCase());
  if (!owner) {
    throw GatewayError.conflict("That referral code doesn't exist.");
  }

  if (owner.userId === actor.id) {
    throw GatewayError.conflict("You can't apply your own referral code.");
  }

  /*
   * Reciprocal farming guard.
   *
   * Two throwaway accounts applying each other's codes minted points with no
   * third party involved. If the code's owner was themselves referred by this
   * user, this is that loop closing.
   */
  if (owner.referredById === actor.id) {
    throw GatewayError.conflict(
      "You referred this person, so you can't also use their code.",
    );
  }

  try {
    return await repo.referrals.claimReferral({
      newUserId: actor.id,
      ownerUserId: owner.userId,
      rewardPoints: REFERRAL_REWARD_POINTS,
    });
  } catch (err) {
    // Lost the race, or already had a referrer. Either way it is a decided
    // outcome the user can understand, not a server error.
    if (err instanceof RepositoryConflictError) {
      throw GatewayError.conflict("You've already applied a referral code.");
    }
    throw err;
  }
}