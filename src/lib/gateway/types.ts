/**
 * API gateway contract.
 *
 * THE RULE: the frontend never touches the backend directly. Pages, components
 * and Server Actions call the gateway; only the gateway calls services, and only
 * services call repositories.
 *
 *   UI  →  gateway  →  service  →  repository  →  database
 *
 * Anything skipping a step is a lint error (see eslint.config.mjs).
 *
 * The gateway is exposed two ways, over ONE implementation:
 *
 *  - `POST /api/v1/:operation` — for client components, and later the mobile
 *    app or any external consumer. This is the public contract.
 *  - `invoke()` — an in-process call for server components, which runs the
 *    identical pipeline (auth → rate limit → validate → authorize → service →
 *    audit) without paying for an HTTP round trip to our own server.
 *
 * Both paths execute the same code, so the HTTP surface cannot drift from what
 * server rendering actually does — the usual failure mode when a codebase has
 * "an API" and "the internal calls".
 */

export type OperationKind = "query" | "mutation";

/** Who may call an operation, before any per-operation ownership check. */
export type AccessPolicy =
  | "public" // no session required (sign-in, health)
  | "authenticated" // any signed-in, onboarded user
  | "onboarding" // signed in, profile not yet created
  | "admin"; // role === "admin"

export type RateTier = "auth" | "read" | "write" | "message" | "payment";

/** Stable, machine-readable failure codes. Safe to expose to the browser. */
export type GatewayErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "rate_limited"
  | "conflict"
  | "provider_error"
  | "internal";

const STATUS_BY_CODE: Record<GatewayErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  rate_limited: 429,
  conflict: 409,
  provider_error: 502,
  internal: 500,
};

/**
 * The only error type that crosses the gateway boundary.
 *
 * Anything else is caught and reported as a generic `internal` — internal
 * details (SQL text, file paths, provider stack traces) must never reach a
 * client.
 */
export class GatewayError extends Error {
  readonly status: number;

  constructor(
    readonly code: GatewayErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "GatewayError";
    this.status = STATUS_BY_CODE[code];
  }

  static unauthenticated(message = "Sign in to continue") {
    return new GatewayError("unauthenticated", message);
  }
  static forbidden(message = "Not allowed") {
    return new GatewayError("forbidden", message);
  }
  static notFound(message = "Not found") {
    return new GatewayError("not_found", message);
  }
  static conflict(message: string) {
    return new GatewayError("conflict", message);
  }
  static validation(message: string, details?: unknown) {
    return new GatewayError("validation_failed", message, details);
  }
}

/** Wire shape for a failed call. */
export interface GatewayErrorBody {
  error: { code: GatewayErrorCode; message: string; details?: unknown };
}
