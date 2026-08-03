import { z } from "zod";

/**
 * Shared input primitives for gateway operations.
 *
 * These exist so a rule that matters for security is written ONCE. Four call
 * sites each spelled out `z.string().url()` independently, and all four were
 * wrong in the same way — which is exactly what a copied validator does.
 */

/**
 * A user-supplied link that will be rendered as an `href`.
 *
 * `z.string().url()` is NOT sufficient here, and this is the whole reason this
 * helper exists. Zod's `url()` accepts anything the WHATWG URL parser accepts,
 * which includes:
 *
 *     javascript:alert(document.cookie)      → accepted
 *     data:text/html,<script>alert(1)</script> → accepted
 *     vbscript:msgbox(1)                     → accepted
 *
 * A `javascript:` URI in an `href` executes on click, in our origin, with the
 * victim's session attached to every same-origin fetch it makes. The session
 * cookie is httpOnly and cannot be read, but it does not need to be — every
 * gateway operation becomes callable as the victim, including the admin ones.
 * The CSP does not help: `javascript:` URIs are governed by `script-src`, and
 * `'unsafe-inline'` is present.
 *
 * So the scheme is checked explicitly against an allowlist. Anything that is
 * not plain http(s) is refused, whatever the URL parser thinks of it.
 */
export const externalUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), {
    message: "Links must start with http:// or https://",
  });
