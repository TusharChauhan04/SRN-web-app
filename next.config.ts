import type { NextConfig } from "next";

/**
 * Security headers applied to every response.
 *
 * CSP is deliberately not set here yet: Razorpay Checkout injects a script and
 * an iframe, and getting the policy wrong silently breaks payments. It is
 * tracked as a Phase 8 item in WEB_MIGRATION_PLAN.md so it lands with the
 * payment flow it has to accommodate.
 */
const securityHeaders = [
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
   * Prisma ships platform-specific query engine binaries and resolves them with
   * runtime `require`, which the bundler cannot trace. Marking it external keeps
   * it in node_modules at runtime instead of being bundled.
   */
  serverExternalPackages: ["@prisma/client", "firebase-admin"],

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;