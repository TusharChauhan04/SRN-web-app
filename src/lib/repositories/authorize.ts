import type { User } from "./types";

/**
 * Defence-in-depth for privileged repository operations.
 *
 * The layering rule is that repositories stay authorization-free and CALLERS
 * gate them. That is the right design — putting request context inside data
 * access would break the seed, the payment webhook, and any future cron.
 *
 * The problem it left is that nothing made an ungated call *look* wrong:
 *
 *   const user = await requireUser();
 *   const data = await repo.users.exportAll(params.id);   // stranger's data
 *
 * That typechecks, reads as correct, and is a full data-subject dump of an
 * arbitrary user. Requiring an explicit `actor` on the dangerous methods turns
 * "forgot to gate" from a silent vulnerability into a compile error, without
 * moving authorization into the repository.
 *
 * These are a second line of defence. Route handlers must STILL call
 * `requireUser` / `requireRole` — this does not replace them.
 */

/**
 * A write lost a race for something only one caller may have.
 *
 * Distinct from a validation error: the request was valid when it was made and
 * someone else got there first.
 */
export class RepositoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryConflictError";
  }
}

export class RepositoryForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryForbiddenError";
  }
}

/**
 * The identity performing a privileged operation.
 *
 * `SYSTEM_ACTOR` exists for callers with no human behind them — the seed
 * script, the Razorpay webhook, scheduled jobs. It is deliberately verbose to
 * type and impossible to produce by accident from a request.
 */
export const SYSTEM_ACTOR = Symbol("system-actor");

/**
 * Nobody is signed in.
 *
 * This exists because the gateway used to substitute `SYSTEM_ACTOR` whenever
 * `ctx.user` was null — which is precisely the unauthenticated case. "No
 * identity" was being promoted to "full system privileges" on exactly the
 * requests where a forgotten policy is most dangerous. Every guard below
 * refuses it, so a `public` operation that reaches a privileged repository
 * method fails instead of succeeding.
 */
export const ANONYMOUS_ACTOR = Symbol("anonymous-actor");

export type Actor = User | typeof SYSTEM_ACTOR | typeof ANONYMOUS_ACTOR;

/** Narrows an actor to a real person, or null for the two symbols. */
export function actorUser(actor: Actor): User | null {
  return actor === SYSTEM_ACTOR || actor === ANONYMOUS_ACTOR ? null : actor;
}

function describe(actor: Actor): string {
  if (actor === SYSTEM_ACTOR) return "system";
  if (actor === ANONYMOUS_ACTOR) return "an unauthenticated caller";
  return `${actor.id} (${actor.role})`;
}

/** Throws unless the actor is an admin, or the system. */
export function assertAdmin(actor: Actor, operation: string): void {
  if (actor === SYSTEM_ACTOR) return;
  if (actor === ANONYMOUS_ACTOR) {
    throw new RepositoryForbiddenError(
      `${operation} requires an admin; actor is ${describe(actor)}`,
    );
  }
  if (actor.role !== "admin") {
    throw new RepositoryForbiddenError(
      `${operation} requires an admin; actor is ${describe(actor)}`,
    );
  }
}

/**
 * Throws unless the actor is acting on their OWN record, or is an admin.
 *
 * This is the guard for the GDPR surface: a user may export or erase their own
 * data, an admin may do it on their behalf, and nobody may do it to a stranger.
 */
export function assertSelfOrAdmin(
  actor: Actor,
  subjectId: string,
  operation: string,
): void {
  if (actor === SYSTEM_ACTOR) return;
  if (actor === ANONYMOUS_ACTOR) {
    throw new RepositoryForbiddenError(
      `${operation} on ${subjectId} requires that user or an admin; actor is ${describe(actor)}`,
    );
  }
  if (actor.role === "admin") return;
  if (actor.id !== subjectId) {
    throw new RepositoryForbiddenError(
      `${operation} on ${subjectId} requires that user or an admin; actor is ${describe(actor)}`,
    );
  }
}
