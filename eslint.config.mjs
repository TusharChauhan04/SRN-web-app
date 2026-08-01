import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Layering rules.
 *
 *   UI  →  gateway  →  service  →  repository  →  provider/database
 *
 * Each layer may only reach the one below it. These rules are what make that a
 * fact rather than a convention — without them, one stray import in a client
 * component pulls the database into the browser bundle, and one forgotten
 * `requireAdmin` silently becomes a PII leak.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma's generated client — not ours to lint.
    "src/generated/**",
  ]),

  // ── UI layer: no data, no providers, no SDKs ──────────────────────────────
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    ignores: [
      // The gateway's own HTTP surface and the health check are transport, not UI.
      "src/app/api/**",
    ],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          /*
           * EXACT paths, not a prefix group: "@/lib/repositories" as a pattern
           * also matches "@/lib/repositories/types", which is a pure
           * types-and-constants module the UI legitimately needs (ROLE_LABELS,
           * ROLE_COLORS) and which pulls in no data access at all.
           */
          paths: [
            {
              name: "@/lib/repositories",
              message:
                "UI must not touch the data layer. Use `gateway` from '@/lib/gateway' (server components) or `callGateway` from '@/lib/gateway/client' (client components). Types and role constants: '@/lib/repositories/types'.",
            },
            {
              name: "@prisma/client",
              message: "UI must not import Prisma. Use the gateway.",
            },
          ],
          patterns: [
            {
              group: [
                "@/lib/repositories/prisma/*",
                "@/lib/db",
                "@/lib/db/*",
                "@/generated/*",
              ],
              // `import type` is allowed: types carry no runtime code, so they
              // cannot drag the database into a bundle or skip a gateway check.
              allowTypeImports: true,
              message:
                "UI must not touch the data layer. Use `gateway` from '@/lib/gateway'.",
            },
            {
              group: [
                "firebase",
                "firebase/*",
                "firebase-admin",
                "firebase-admin/*",
                "razorpay",
              ],
              message:
                "UI must not import provider SDKs. Go through src/lib/providers/*, which exists so these can be swapped by config.",
              allowTypeImports: true,
            },
            {
              group: ["@/lib/services/*"],
              message:
                "UI must not call services directly — that skips the gateway's auth, rate limiting and validation. Use `gateway` from '@/lib/gateway'.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },

  // ── Gateway layer: may use services, not repositories directly ───────────
  {
    files: ["src/lib/gateway/**/*.ts"],
    ignores: [
      // core.ts legitimately needs the rate limiter and audit log.
      "src/lib/gateway/core.ts",
      "src/lib/gateway/context.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/repositories/prisma/*", "@/lib/db", "@/lib/db/*", "@/generated/*"],
              message:
                "The gateway calls services, which call repositories. It must not reach the Prisma layer itself.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },

  // ── Everything below the repositories: only implementations touch Prisma ──
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/repositories/prisma/**",
      "src/lib/db/**",
      "src/generated/**",
      "src/app/**",
      "src/components/**",
      "src/lib/gateway/**",
    ],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/generated/prisma", "@/generated/prisma/*", "@prisma/client", "@/lib/db", "@/lib/db/*"],
              message:
                "Prisma is confined to src/lib/repositories/prisma/ so the database stays swappable. See DATABASE.md.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },

  /*
   * Provider SDKs are confined to their own directories.
   *
   * NOTE the exclusions: in flat config, a later block that sets the SAME rule
   * REPLACES the earlier one rather than merging. Without excluding the layers
   * that already declare `no-restricted-imports` above, this block would
   * silently switch their data-layer restrictions off — which it did, and the
   * only reason it was caught was probing the rule instead of assuming it worked.
   */
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/providers/**",
      "src/generated/**",
      // Covered by their own blocks above, which also restrict provider SDKs.
      "src/app/**",
      "src/components/**",
      "src/lib/gateway/**",
    ],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "razorpay",
              message:
                "Razorpay is confined to src/lib/providers/payments/. Use `paymentProvider()` so it can be swapped by config.",
            },
            {
              name: "firebase-admin",
              message:
                "Firebase Admin is confined to src/lib/providers/auth/. Use `authProvider()`.",
            },
          ],
          patterns: [
            {
              group: ["firebase/*", "firebase-admin/*"],
              message:
                "Firebase SDKs are confined to src/lib/providers/auth/. Use `authProvider()` or `authClient()`.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
