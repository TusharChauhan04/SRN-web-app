import "server-only";

/**
 * The gateway pipeline.
 *
 * Every data operation in the app goes through `invoke`, whether it arrives
 * over HTTP or from a server component. The pipeline is, in order:
 *
 *   resolve context → rate limit → access policy → validate input
 *     → handler (service layer) → audit
 *
 * Centralising it is the point: authorization, throttling and validation cannot
 * be forgotten on one screen out of forty, because there is no other way in.
 */
import { ZodError, type TypeOf, type ZodType } from "zod";
import { repo } from "@/lib/repositories";
import {
  RepositoryForbiddenError,
  SYSTEM_ACTOR,
  type Actor,
} from "@/lib/repositories/authorize";
import type { User } from "@/lib/repositories/types";
import { getContext, type GatewayContext } from "./context";
import {
  GatewayError,
  type AccessPolicy,
  type OperationKind,
  type RateTier,
} from "./types";

/** Limits per tier, adapted from the mobile backend's dual-layer approach. */
const RATE_LIMITS: Record<RateTier, { limit: number; windowMs: number }> = {
  auth: { limit: 10, windowMs: 60_000 },
  payment: { limit: 5, windowMs: 60_000 },
  write: { limit: 60, windowMs: 60_000 },
  message: { limit: 120, windowMs: 60_000 },
  read: { limit: 300, windowMs: 60_000 },
};

/**
 * What a handler receives. Note it gets an `actor` for the repository layer's
 * own guards, and NOT a repository — handlers are services, and services are
 * the only things allowed to reach the data layer.
 */
export interface HandlerContext {
  ctx: GatewayContext;
  /** The signed-in user. Non-null for `authenticated` and `admin` operations. */
  user: User;
  /** Pass to privileged repository methods; they assert on it. */
  actor: Actor;
}

export interface OperationDefinition<TInput, TOutput> {
  name: string;
  kind: OperationKind;
  access: AccessPolicy;
  rateTier?: RateTier;
  /** Zod schema. Use `z.void()` for operations that take no input. */
  input: ZodType<TInput>;
  handler: (input: TInput, hc: HandlerContext) => Promise<TOutput>;
}

/** Any registered operation, with its input/output types erased. */
type AnyOperation = OperationDefinition<never, unknown>;

const registry = new Map<string, AnyOperation>();

/**
 * Registers an operation. Duplicate names are a programming error.
 *
 * The generic is anchored to the SCHEMA rather than a free `TInput`, so the
 * input type is derived from Zod and the output type is inferred solely from
 * `handler`. Inferring both from a shared type parameter made TypeScript pick
 * `unknown` for the output whenever `audit` appeared before `handler`.
 */
export function defineOperation<TSchema extends ZodType, TOutput>(def: {
  name: string;
  kind: OperationKind;
  access: AccessPolicy;
  rateTier?: RateTier;
  input: TSchema;
  handler: (input: TypeOf<TSchema>, hc: HandlerContext) => Promise<TOutput>;
}): OperationDefinition<TypeOf<TSchema>, TOutput> {
  if (registry.has(def.name)) {
    throw new Error(`Duplicate gateway operation: ${def.name}`);
  }
  const operation = def as unknown as OperationDefinition<
    TypeOf<TSchema>,
    TOutput
  >;
  registry.set(def.name, operation as unknown as AnyOperation);
  return operation;
}

export function getOperation(name: string): AnyOperation | null {
  return registry.get(name) ?? null;
}

export function registeredOperationNames(): string[] {
  return [...registry.keys()].sort();
}

function rateKey(ctx: GatewayContext, tier: RateTier): string {
  // Prefer the authenticated identity; fall back to IP, then to a coarse
  // fingerprint so an unidentifiable caller cannot lock out everyone else by
  // sharing one global bucket.
  if (ctx.uid) return `${tier}:uid:${ctx.uid}`;
  if (ctx.ip) return `${tier}:ip:${ctx.ip}`;
  return `${tier}:fp:${(ctx.userAgent ?? "unknown").slice(0, 120)}`;
}

function assertAccess(ctx: GatewayContext, def: OperationDefinition<unknown, unknown>): void {
  switch (def.access) {
    case "public":
      return;

    case "onboarding":
      // Signed in with a verified identity but no profile row yet.
      if (!ctx.uid) throw GatewayError.unauthenticated();
      return;

    case "authenticated":
      if (!ctx.uid) throw GatewayError.unauthenticated();
      if (!ctx.user) {
        throw GatewayError.forbidden("Finish setting up your account first");
      }
      return;

    case "admin":
      if (!ctx.uid) throw GatewayError.unauthenticated();
      if (!ctx.user) throw GatewayError.forbidden();
      if (ctx.user.role !== "admin") {
        // Deliberately flat: naming the required role tells a prober which
        // routes are admin-gated.
        throw GatewayError.forbidden();
      }
      return;
  }
}

/**
 * Runs an operation end to end.
 *
 * This is the ONLY entry point to application data. Server components call it
 * directly; the /api/v1 route handler calls it after parsing the request.
 */
export async function invoke<TInput, TOutput>(
  def: OperationDefinition<TInput, TOutput>,
  rawInput: unknown,
): Promise<TOutput> {
  const ctx = await getContext();

  // 1. Throttle before doing any real work, so an abusive caller is cheap.
  const tier: RateTier =
    def.rateTier ?? (def.kind === "query" ? "read" : "write");
  const { limit, windowMs } = RATE_LIMITS[tier];
  const verdict = await repo.rateLimit.hit(rateKey(ctx, tier), limit, windowMs);
  if (!verdict.allowed) {
    throw new GatewayError("rate_limited", "Too many requests", {
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((verdict.resetAt.getTime() - Date.now()) / 1000),
      ),
    });
  }

  // 2. Who may call this at all.
  assertAccess(ctx, def as OperationDefinition<unknown, unknown>);

  // 3. Shape and bounds of the input.
  let input: TInput;
  try {
    input = def.input.parse(rawInput);
  } catch (err) {
    if (err instanceof ZodError) {
      throw GatewayError.validation("Check the values you entered", err.issues);
    }
    throw err;
  }

  // 4. The handler. `user` is non-null for every policy that reaches here with
  // one; `onboarding` and `public` handlers must not read it.
  const hc: HandlerContext = {
    ctx,
    user: ctx.user as User,
    actor: (ctx.user ?? SYSTEM_ACTOR) as Actor,
  };

  let output: TOutput;
  try {
    output = await def.handler(input, hc);
  } catch (err) {
    // The repository layer's own guards are defence in depth; if one fires it
    // means an operation forgot its policy. Surface as forbidden, log loudly.
    if (err instanceof RepositoryForbiddenError) {
      console.error(`[gateway] ${def.name} tripped a repository guard:`, err.message);
      throw GatewayError.forbidden();
    }
    if (err instanceof GatewayError) throw err;

    console.error(`[gateway] ${def.name} failed:`, err);
    throw new GatewayError("internal", "Something went wrong");
  }

  /*
   * Audit is deliberately NOT done here. It lives in the services, which have
   * the typed domain object and know what is actually worth recording — a
   * generic hook here could only see an opaque result, and trying to type it
   * broke output inference for every operation.
   */
  return output;
}
