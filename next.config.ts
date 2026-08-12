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

const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${RAZORPAY_ORIGINS.join(" ")}`,
  `style-src 'self' 'unsafe-inline'`,
  // Avatars and portfolio images are arbitrary-origin user content.
  `img-src 'self' data: blob: https:`,
  `font-src 'self' data:`,
  `connect-src 'self' ${RAZORPAY_ORIGINS.join(" ")}`,
  // Checkout renders in an iframe from its own origin.
  `frame-src 'self' ${RAZORPAY_ORIGINS.join(" ")}`,
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
