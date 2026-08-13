import type { NextConfig } from "next";

/**
 * Content-Security-Policy.
 *
 * Landed alongside the payment page rather than in a later hardening pass,
 * because Razorpay Checkout injects a script and an iframe — writing the policy
 * without the thing it has to accommodate is how you ship a page that silently
 * cannot take money.
 *
 * `'unsafe-inline'` on script-src is required by Next.js's inline bootstrap and
 * by Checkout itself. Removing it needs a nonce threaded through the document,
 * which is a real change rather than a config tweak — noted, not pretended.
 */
const RAZORPAY_ORIGINS = [
  "https://checkout.razorpay.com",
  "https://api.razorpay.com",
  "https://lumberjack.razorpay.com",
];

/**
 * Firebase Authentication origins.
 *
 * This policy was written around Razorpay and silently blocked sign-in. Google
 * sign-in is not one request: the SDK loads a helper script from
 * apis.google.com, frames the project's auth handler, and exchanges tokens with
 * the Identity Toolkit. The browser reported it as
 *
 *   Firebase: Error (auth/internal-error)
 *
 * which names nothing — the real cause was only visible in the console as a CSP
 * violation on apis.google.com.
 *
 * `connect-src` matters most and is the least obvious: EVERY auth method talks
 * to identitytoolkit, so omitting it breaks password sign-in and the
 * email-verification link too, not just the Google button. Both were reported
 * as separate bugs; they were this one.
 *
 * The auth domain is read from the same public variable the client SDK uses, so
 * the policy follows the Firebase project rather than hard-coding it. It is set
 * at build time on Vercel; the wildcard is a fallback for a build without it,
 * because a missing origin here fails closed and locks everyone out.
 */
const FIREBASE_AUTH_DOMAIN = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
const FIREBASE_AUTH_HANDLER = FIREBASE_AUTH_DOMAIN
  ? `https://${FIREBASE_AUTH_DOMAIN}`
  : "https://*.firebaseapp.com";

/** Loads the gapi helper the popup/redirect flow is built on. */
const GOOGLE_SCRIPT_ORIGINS = [
  "https://apis.google.com",
  "https://www.gstatic.com",
];

/** Token mint, refresh, and the verification-email call. */
const FIREBASE_API_ORIGINS = [
  "https://identitytoolkit.googleapis.com",
  "https://securetoken.googleapis.com",
  "https://www.googleapis.com",
];

/** The auth handler iframe and Google's account chooser. */
const FIREBASE_FRAME_ORIGINS = [
  FIREBASE_AUTH_HANDLER,
  "https://accounts.google.com",
  "https://apis.google.com",
];

const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${[...RAZORPAY_ORIGINS, ...GOOGLE_SCRIPT_ORIGINS].join(" ")}`,
  `style-src 'self' 'unsafe-inline'`,
  // Avatars and portfolio images are arbitrary-origin user content.
  `img-src 'self' data: blob: https:`,
  `font-src 'self' data:`,
  `connect-src 'self' ${[...RAZORPAY_ORIGINS, ...FIREBASE_API_ORIGINS, FIREBASE_AUTH_HANDLER].join(" ")}`,
  // Checkout renders in an iframe from its own origin; Firebase frames its
  // auth handler and Google frames the account chooser.
  `frame-src 'self' ${[...RAZORPAY_ORIGINS, ...FIREBASE_FRAME_ORIGINS].join(" ")}`,
  `form-action 'self'`,
  // Nothing may frame us — the header equivalent of X-Frame-Options: DENY.
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `object-src 'none'`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(self)",
  },
  {
    // Assumes HTTPS in production, per deployment-readiness item 5.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  /**
   * Pin the workspace root to THIS directory.
   *
   * Next infers the root from the nearest lockfile, and an unrelated
   * `pnpm-lock.yaml` sitting in a parent directory made it treat that whole
   * folder as the project. It happened to build correctly, but file tracing was
   * rooted somewhere it shouldn't be — which decides what gets bundled into a
   * deployment. Pinning it removes the guess.
   */
  turbopack: {
    root: __dirname,
  },

  /**
   * Prisma ships platform-specific query engine binaries and resolves them with
   * runtime `require`, which the bundler cannot trace. Marking these external
   * keeps them in node_modules at runtime instead of being bundled.
   */
  serverExternalPackages: ["@prisma/client"],

  /**
   * Force `firebase-admin` to be BUNDLED rather than left external.
   *
   * Next ships a default opt-out list (`next/dist/lib/server-external-packages.jsonc`)
   * and `firebase-admin` is on it. `serverExternalPackages` only ADDS to that
   * list, so removing our entry did nothing — the package stayed external and
   * Vercel returned 500 on every route that imports it:
   *
   *   Error: Failed to load external module firebase-admin-<hash>/auth
   *
   * It reproduced nowhere locally because this machine runs Node 24, which can
   * `require()` an ES module; Vercel's runtime could not.
   *
   * `transpilePackages` is the documented lever: Next computes its opt-out set
   * as `defaults + serverExternalPackages - transpilePackages`, so naming the
   * package here removes it from the defaults and it gets bundled. The build
   * only rejects a package listed in transpilePackages AND our own
   * serverExternalPackages — the default list does not conflict.
   */
  transpilePackages: ["firebase-admin"],

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Private objects are served through a signed route; belt and braces
        // against a shared cache holding an identity document.
        source: "/api/v1/storage/read",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
