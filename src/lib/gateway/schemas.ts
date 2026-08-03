import { z } from "zod";

/**
 * Shared input primitives for gateway operations.
 *
 * These exist so a rule that matters for security is written ONCE. Four call
 * sites each spelled out `z.string().url()` independently, and all four were
 * wrong in the same way — which is exactly what a copied validator does.
 */

/**
 * The scheme allowlist, as one function — the single source of truth.
 *
 * `z.string().url()` is NOT sufficient, and this is the whole reason this
 * module exists. Zod's `url()` accepts anything the WHATWG URL parser accepts,
 * which includes:
 *
 *     javascript:alert(document.cookie)        → accepted
 *     data:text/html,<script>alert(1)</script> → accepted
 *     vbscript:msgbox(1)                       → accepted
 *
 * A `javascript:` URI in an `href` executes on click, in our origin, with the
 * victim's session attached to every same-origin fetch it makes. The session
 * cookie is httpOnly and cannot be read, but it does not need to be — every
 * gateway operation becomes callable as the victim, including the admin ones.
 * The CSP does not help: `javascript:` URIs are governed by `script-src`, and
 * `'unsafe-inline'` is present.
 *
 * So the scheme is checked explicitly. Anything that is not plain http(s) is
 * refused, whatever the URL parser thinks of it.
 *
 * Exported because the render sinks need the SAME rule (`safeHref` in
 * components/ui.tsx). Validating on write and defending on render is correct
 * defence-in-depth, but the two layers were each spelling out this regex
 * independently — which is exactly the duplication this module was created to
 * end. Change the allowlist here and both layers move together.
 *
 * This module imports only `zod`, so the browser bundle can use it safely.
 */
export function isSafeExternalUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^https?:\/\//i.test(value.trim());
}

/** A user-supplied link that will be rendered as an `href`. */
export const externalUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine(isSafeExternalUrl, {
    message: "Links must start with http:// or https://",
  });
