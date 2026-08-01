"use client";

/**
 * Browser-side gateway client.
 *
 * The ONLY way client components reach application data. There is no direct
 * access to repositories or the database from the browser — this posts to
 * /api/v1/:operation, which runs the same pipeline server components use.
 *
 * Server components should import `gateway` from "@/lib/gateway" instead and
 * call in-process; going over HTTP to our own server would add a pointless
 * round trip.
 */
import type { GatewayErrorCode } from "./types";

export class GatewayCallError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "GatewayCallError";
  }
}

interface GatewayResponse<T> {
  data?: T;
  error?: { code: GatewayErrorCode; message: string; details?: unknown };
}

/**
 * Calls a gateway operation by name.
 *
 * Operation names are strings rather than a generated union because the set
 * grows every phase; the server rejects unknown names with `not_found`, so a
 * typo fails loudly at the first call rather than silently doing nothing.
 */
export async function callGateway<TOutput = unknown>(
  operation: string,
  input?: unknown,
): Promise<TOutput> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/${operation}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
      // Session cookie is httpOnly; it rides along automatically.
      credentials: "same-origin",
    });
  } catch {
    throw new GatewayCallError(
      "internal",
      "Couldn't reach the server. Check your connection.",
    );
  }

  let body: GatewayResponse<TOutput>;
  try {
    body = (await res.json()) as GatewayResponse<TOutput>;
  } catch {
    throw new GatewayCallError("internal", "The server returned an invalid response.");
  }

  if (!res.ok || body.error) {
    const err = body.error;
    throw new GatewayCallError(
      err?.code ?? "internal",
      err?.message ?? "Something went wrong.",
      err?.details,
    );
  }

  return body.data as TOutput;
}
