import "server-only";

/**
 * Data export and account deletion — the user-facing half of the rights the
 * admin panel can already exercise on someone's behalf.
 *
 * Deletion is a REQUEST with a grace period, not an immediate wipe. Mobile's
 * backend worked the same way (`/gdpr/account` sets a deletion date,
 * `/gdpr/account/cancel-deletion` withdraws it), and it is the right shape:
 * erasure is irreversible, and a moment of anger shouldn't be.
 */
import { repo } from "@/lib/repositories";
import type { User } from "@/lib/repositories/types";
import { SYSTEM_ACTOR, type Actor } from "@/lib/repositories/authorize";
import { GatewayError } from "@/lib/gateway/types";
import { deleteIdentity } from "./auth.service";

/** How long a user can change their mind before erasure becomes permanent. */
export const DELETION_GRACE_DAYS = 30;

export interface DataRightsView {
  deletionRequestedAt: Date | null;
  /** When erasure becomes permanent, if a request is in flight. */
  deletionEffectiveAt: Date | null;
  storedFileCount: number;
}

export async function getMyDataRights(actor: User): Promise<DataRightsView> {
  const keys = await repo.users.listStorageKeys(actor.id, actor);

  const deletionRequestedAt = actor.deletionRequestedAt ?? null;
  const deletionEffectiveAt = deletionRequestedAt
    ? new Date(
        deletionRequestedAt.getTime() +
          DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
      )
    : null;

  return {
    deletionRequestedAt,
    deletionEffectiveAt,
    storedFileCount: keys.length,
  };
}

/**
 * The full export bundle.
 *
 * `exportAll` already redacts other people's personal data — review authors,
 * reporter identity, profile-view viewer ids and block lists are stripped or
 * reduced to counts. A subject access request is not a licence to receive a
 * different person's data.
 */
export async function exportMyData(
  actor: User,
): Promise<Record<string, unknown>> {
  const bundle = await repo.users.exportAll(actor.id, actor);

  await repo.audit
    .record({
      actorId: actor.id,
      action: "gdpr.export",
      target: actor.id,
    })
    .catch(() => {});

  return bundle;
}

export async function requestDeletion(actor: User): Promise<User> {
  if (actor.deletionRequestedAt) {
    throw GatewayError.conflict("Deletion is already scheduled.");
  }

  // Admins are excluded for the same reason the admin screen excludes them:
  // losing the last administrator locks everyone out of the platform.
  if (actor.role === "admin") {
    throw GatewayError.forbidden(
      "Administrator accounts can't be self-deleted. Ask another administrator.",
    );
  }

  const updated = await repo.users.markForDeletion(actor.id, new Date(), actor);

  await repo.audit
    .record({
      actorId: actor.id,
      action: "gdpr.deletion_requested",
      target: actor.id,
    })
    .catch(() => {});

  return updated;
}

export async function cancelDeletion(actor: User): Promise<User> {
  if (!actor.deletionRequestedAt) {
    throw GatewayError.conflict("No deletion is scheduled.");
  }

  const updated = await repo.users.cancelDeletion(actor.id, actor);

  await repo.audit
    .record({
      actorId: actor.id,
      action: "gdpr.deletion_cancelled",
      target: actor.id,
    })
    .catch(() => {});

  return updated;
}

/**
 * The erasure sequence itself, shared by the admin path and the GDPR path.
 *
 * Order is load-bearing and the failure handling is the point:
 *
 *  1. read the storage keys, because `anonymize` deletes the rows holding them
 *  2. delete the objects, and STOP if any of them fail
 *  3. only then anonymise, which is the irreversible step
 *
 * Step 2 used to be `.catch(() => {})`. A failed delete was silent, erasure
 * reported success, and then step 3 destroyed the only record of which objects
 * still existed — leaving KYC identity documents in the bucket with nothing
 * left to point at them, and no way to retry. Throwing keeps the keys intact so
 * the operation can simply be run again once the cause is fixed.
 */
async function eraseUserData(
  userId: string,
  actor: Actor,
  auditAction: string,
): Promise<{ storageObjectsRemoved: number }> {
  const keys = await repo.users.listStorageKeys(userId, actor);

  const { storageProvider } = await import(
    "@/lib/providers/storage/index.server"
  );
  const results = await Promise.allSettled(
    keys.map((key) => storageProvider().delete(key)),
  );

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error(
      `[erasure] ${failed.length}/${keys.length} objects could not be deleted ` +
        `for ${userId}; database left intact so this can be retried`,
      failed.map((f) => (f as PromiseRejectedResult).reason),
    );
    throw new GatewayError(
      "provider_error",
      `Couldn't delete ${failed.length} stored file(s). Nothing has been ` +
        `erased — try again once storage is reachable.`,
    );
  }

  await repo.users.anonymize(userId, actor);

  // The identity provider holds the account independently of our database.
  // Logged rather than thrown: the personal data is already gone at this point,
  // and failing here would leave the caller unable to retry a completed erasure.
  await deleteIdentity(userId).catch((err) => {
    console.error("[erasure] identity deletion failed for", userId, err);
  });

  await repo.audit
    .record({
      // Omitted when there is no human behind the action — a scheduled run.
      // Recording a fake actor would make the audit trail lie, and `actorId` is
      // optional precisely so it can be absent rather than invented.
      //
      // Checked on `typeof symbol`, not `=== SYSTEM_ACTOR`: `Actor` also admits
      // ANONYMOUS_ACTOR, which the repository guards reject long before this
      // line — but narrowing has to be sound regardless of what happens to
      // reach here later.
      actorId: typeof actor === "symbol" ? undefined : actor.id,
      action: auditAction,
      target: userId,
      metadata: { storageObjectsRemoved: keys.length },
    })
    .catch(() => {});

  return { storageObjectsRemoved: keys.length };
}

export async function performErasure(
  userId: string,
  actor: User,
): Promise<{ storageObjectsRemoved: number }> {
  return eraseUserData(userId, actor, "gdpr.erased");
}

export interface DueErasureResult {
  considered: number;
  erased: number;
  failed: { userId: string; reason: string }[];
}

/**
 * The scheduled half of the right to erasure, and the reason it now exists.
 *
 * `requestDeletion` recorded `deletionRequestedAt` and NOTHING ever acted on
 * it — `performErasure` had zero callers. The app accepted "delete my data",
 * showed the user a date, and then silently kept everything. That is the one
 * failure here with a legal dimension rather than merely a user-visible one,
 * and it is invisible: no error, no alert, just a queue that grows.
 *
 * Design notes that are deliberate, not incidental:
 *
 *  - the GRACE PERIOD lives here, not in the repository. The repository is
 *    asked "who requested before this moment"; deciding what that moment is, is
 *    the business rule.
 *  - `limit` bounds a run. Erasure is irreversible, so a job that wakes with a
 *    wrong cutoff can destroy at most a bounded number of accounts.
 *  - one failure must not stop the rest, and must not be swallowed either. Each
 *    account is erased independently and failures are REPORTED, so the caller
 *    can surface a non-zero count instead of logging into a void. eraseUserData
 *    already leaves the database intact when object deletion fails, so a failed
 *    account is simply retried on the next run.
 */
export async function runDueErasures(
  limit = 50,
  now: Date = new Date(),
): Promise<DueErasureResult> {
  const cutoff = new Date(
    now.getTime() - DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
  );

  const due = await repo.users.findDueForDeletion(cutoff, SYSTEM_ACTOR, limit);

  const failed: DueErasureResult["failed"] = [];
  let erased = 0;

  for (const user of due) {
    try {
      await eraseUserData(user.id, SYSTEM_ACTOR, "gdpr.erased_scheduled");
      erased += 1;
    } catch (err) {
      failed.push({
        userId: user.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { considered: due.length, erased, failed };
}

/** The same sequence, for the admin-initiated path. */
export async function performErasureAsAdmin(
  userId: string,
  actor: User,
): Promise<{ storageObjectsRemoved: number }> {
  return eraseUserData(userId, actor, "admin.user.erased");
}
