import "server-only";

/**
 * The gateway — the single entry point to application data.
 *
 * Pages, components and Server Actions import `gateway` from here. Nothing
 * above this line may import a repository, a Prisma client, or a provider SDK;
 * ESLint enforces it.
 *
 *   import { gateway } from "@/lib/gateway";
 *   const data = await gateway.dashboard.get();
 *
 * The same operations are reachable over HTTP at POST /api/v1/:operation for
 * client components and future external consumers. Both transports run the
 * identical pipeline, so the API cannot drift from what server rendering does.
 */
import { invoke } from "./core";
import type { CompleteOnboardingInput } from "@/lib/services/auth.service";
import * as auth from "./operations/auth";
import * as dashboard from "./operations/dashboard";

/**
 * Typed façade. Each method is a thin wrapper around `invoke` so call sites get
 * full inference on both input and output.
 */
export const gateway = {
  auth: {
    createSession: (input: { credential: string }) =>
      invoke(auth.createSession, input),
    destroySession: (input: { cookieValue: string | null }) =>
      invoke(auth.destroySession, input),
    completeOnboarding: (input: CompleteOnboardingInput) =>
      invoke(auth.completeOnboarding, input),
    me: () => invoke(auth.me, undefined),
  },
  dashboard: {
    get: () => invoke(dashboard.get, undefined),
  },
} as const;

/**
 * Registers every operation for HTTP dispatch.
 *
 * Importing the modules is what populates the registry, so this must import all
 * of them — an operation that is never imported is not reachable over HTTP.
 */
export function loadOperations(): void {
  void auth;
  void dashboard;
}

export { getOperation, invoke, registeredOperationNames } from "./core";
export { getContext } from "./context";
export { GatewayError } from "./types";
export type { GatewayErrorBody, GatewayErrorCode } from "./types";
