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
 *
 * ───────────────────────────────────────────────────────────────────────────
 * HOW THIS FILE IS STRUCTURED, AND WHY IT MUST STAY THIS WAY
 *
 * In ESLint flat config, two blocks that match the same file and set the same
 * rule key do NOT merge — the later one REPLACES the earlier one wholesale.
 *
 * This file used to be several overlapping `src/**` blocks that each set
 * `@typescript-eslint/no-restricted-imports`, so the last one silently switched
 * off everything the earlier ones declared. That regressed THREE times. Twice
 * it was caught only by manually probing the rule; the third time the whole
 * service layer had been running unguarded — a service could import Prisma and
 * nothing objected, which is exactly the boundary the swappable-database design
 * depends on. Nothing in the test suite noticed, because a passing lint run is
 * not evidence that a rule exists.
 *
 * So:
 *
 *   1. `LAYERS` is the single source of truth. Each layer names the restriction
 *      fragments that apply to it and they are COMPOSED into ONE declaration.
 *      There is no second block that could overwrite a first.
 *
 *   2. Layer globs are MUTUALLY EXCLUSIVE — every file under `src/` matches
 *      exactly one layer.
 *
 *   3. `tests/layering.test.ts` runs ESLint against source that violates each
 *      rule and asserts it actually reports, and asserts every `src/` file
 *      resolves to a non-empty restriction set. Delete a restriction and a test
 *      fails. That is the guardrail this file did not have.
 *
 * If you add a layer, add it to `LAYERS`. Do not append another block.
 * ───────────────────────────────────────────────────────────────────────────
 */

// ── Reusable restriction fragments ─────────────────────────────────────────

/** Prisma and the raw client are confined to the repository implementations. */
const noPrisma = {
  paths: [
    {
      name: "@prisma/client",
      message:
        "Prisma is confined to src/lib/repositories/prisma/ so the database stays swappable. See DATABASE.md.",
    },
  ],
  patterns: [
    {
      group: ["@/lib/repositories/prisma/*", "@/lib/db", "@/lib/db/*"],
      // `import type` is allowed: types carry no runtime code, so they cannot
      // drag the database into a bundle or skip a gateway check.
      allowTypeImports: true,
      message:
        "Prisma is confined to src/lib/repositories/prisma/ so the database stays swappable. See DATABASE.md.",
    },
  ],
};

/**
 * The repository barrel itself.
 *
 * An EXACT path, not a prefix group: "@/lib/repositories/types" is a pure
 * types-and-constants module (ROLE_LABELS, ROLE_COLORS) carrying no data
 * access, which the UI legitimately needs.
 */
const noRepositories = {
  paths: [
    {
      name: "@/lib/repositories",
      message:
        "Only services may reach the repository layer. Use `gateway` from '@/lib/gateway' (server components) or `callGateway` from '@/lib/gateway/client' (client components). Types and role constants: '@/lib/repositories/types'.",
    },
  ],
};

/** Services must be reached through the gateway, never called directly. */
const noServices = {
  patterns: [
    {
      group: ["@/lib/services/*"],
      allowTypeImports: true,
      message:
        "Calling a service directly skips the gateway's auth, rate limiting and validation. Use `gateway` from '@/lib/gateway'.",
    },
  ],
};

/** Third-party SDKs live behind the provider abstractions. */
const noProviderSdks = {
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
    {
      name: "firebase",
      message:
        "Firebase is confined to src/lib/providers/auth/. Use `authProvider()` or `authClient()`.",
    },
  ],
  patterns: [
    {
      group: ["firebase/*", "firebase-admin/*"],
      allowTypeImports: true,
      message:
        "Firebase SDKs are confined to src/lib/providers/auth/. Use `authProvider()` or `authClient()`.",
    },
  ],
};

/**
 * Server-side provider modules.
 *
 * `@/lib/providers/auth/client` is deliberately exempt: browser identity cannot
 * round-trip through a server gateway, so the login form has to speak to the
 * client SDK. Everything else — payments, storage, OTP, email — is server-only
 * and must not be reachable from a page or component.
 */
const noServerProviders = {
  patterns: [
    {
      /*
       * Matched by FILE SUFFIX, not by exempting a path.
       *
       * Every server-side provider module is named `*.server.ts`, and the one
       * module the browser may legitimately reach is `auth/client`. Keying on
       * the suffix means the boundary is visible in the filename, and a new
       * provider is covered the moment it is named correctly — no allowlist to
       * remember to update.
       */
      group: ["@/lib/providers/*/*.server"],
      allowTypeImports: true,
      message:
        "UI must not import server providers. Go through `gateway` — the provider abstractions exist so these can be swapped by config. (@/lib/providers/auth/client is the one exception, for browser sign-in.)",
    },
  ],
};

/** proxy.ts must not become a place where security decisions live. */
const noSecurityInProxy = {
  patterns: [
    {
      group: [
        "@/lib/providers/*",
        "@/lib/gateway",
        "@/lib/gateway/*",
        "@/lib/auth/session",
        "@/lib/services/*",
        "@/lib/repositories",
        "@/lib/repositories/*",
        "@/lib/db",
        "@/lib/db/*",
      ],
      message:
        "proxy.ts is a redirect optimisation, not a security boundary. It does not run for /api/*, so any check here is absent from every data route. Enforce in the gateway pipeline (assertAccess) or an authenticated layout instead. Importing the session cookie NAME from @/lib/auth/cookie is fine.",
    },
  ],
};

/** Merges fragments into ONE declaration, so nothing can replace anything. */
function compose(...fragments) {
  return [
    "error",
    {
      paths: fragments.flatMap((f) => f.paths ?? []),
      patterns: fragments.flatMap((f) => f.patterns ?? []),
    },
  ];
}

// ── The layers. These globs MUST stay mutually exclusive. ───────────────────

export const LAYERS = [
  {
    name: "ui",
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    // Route handlers are transport, not UI — they get their own layer.
    ignores: ["src/app/api/**"],
    restrictions: [
      noRepositories,
      noPrisma,
      noServices,
      noProviderSdks,
      noServerProviders,
    ],
  },
  {
    /*
     * Client-side app code living outside src/app and src/components.
     *
     * AuthContext is a "use client" component here. It previously matched only
     * the catch-all layer, which meant a file that ships to the BROWSER was
     * allowed to import the repository layer — one autocomplete away from
     * putting Prisma in the client bundle.
     */
    name: "client-lib",
    files: ["src/lib/auth/**/*.{ts,tsx}"],
    // noServerProviders included deliberately: this layer exists BECAUSE a
    // "use client" file was falling through, and the whole point is keeping
    // server-only modules out of the browser bundle. Omitting it gave the
    // highest-risk client file every restriction except the relevant one.
    restrictions: [
      noRepositories,
      noPrisma,
      noServices,
      noProviderSdks,
      noServerProviders,
    ],
  },
  {
    /*
     * Route handlers: the gateway's HTTP surface, the payment webhook, the
     * storage routes. They may call services and providers — the webhook has no
     * session and genuinely cannot go through the gateway — but they must not
     * reach the data layer directly.
     */
    name: "api-routes",
    files: ["src/app/api/**/*.{ts,tsx}"],
    ignores: ["src/app/api/healthz/route.ts"],
    restrictions: [noRepositories, noPrisma, noProviderSdks],
  },
  {
    /*
     * The health check is a deliberate exception, for the reason stated in its
     * own header: it must answer without a session, without the gateway
     * pipeline, and without touching the rate limiter — which writes to the
     * very database it is checking. So it pings the repository directly.
     *
     * It still may not reach Prisma or an SDK: `repo.health.ping()` is the
     * whole of its data access, and that stays swappable with everything else.
     */
    name: "healthz",
    files: ["src/app/api/healthz/route.{ts,tsx}"],
    restrictions: [noPrisma, noProviderSdks],
  },
  {
    name: "proxy",
    files: ["src/proxy.ts"],
    restrictions: [noSecurityInProxy],
  },
  {
    /*
     * The gateway pipeline itself. core.ts needs the rate limiter and
     * context.ts needs to resolve the caller, so the repository barrel is
     * permitted for these two files and nowhere else in the gateway.
     */
    name: "gateway-core",
    files: ["src/lib/gateway/core.ts", "src/lib/gateway/context.ts"],
    restrictions: [noPrisma, noProviderSdks],
  },
  {
    name: "gateway",
    files: ["src/lib/gateway/**/*.{ts,tsx}"],
    ignores: ["src/lib/gateway/core.ts", "src/lib/gateway/context.ts"],
    restrictions: [noRepositories, noPrisma, noProviderSdks],
  },
  {
    /* Providers are the bottom layer: they must not reach back up. */
    name: "providers",
    files: ["src/lib/providers/**/*.{ts,tsx}"],
    restrictions: [noRepositories, noPrisma, noServices],
  },
  {
    /* The one place Prisma is allowed. */
    name: "repositories-prisma",
    files: ["src/lib/repositories/prisma/**/*.{ts,tsx}"],
    restrictions: [noServices, noProviderSdks],
  },
  {
    name: "db",
    files: ["src/lib/db/**/*.{ts,tsx}"],
    restrictions: [noServices],
  },
  {
    /*
     * Everything else under src/: services, the repository interfaces and
     * barrel, config, nav. Services may use repositories; nobody here may reach
     * Prisma or an SDK directly.
     */
    name: "core",
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/app/**",
      "src/components/**",
      "src/lib/auth/**",
      "src/lib/gateway/**",
      "src/lib/providers/**",
      "src/lib/repositories/prisma/**",
      "src/lib/db/**",
      "src/proxy.ts",
    ],
    restrictions: [noPrisma, noProviderSdks],
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),

  ...LAYERS.map((layer) => ({
    files: layer.files,
    ...(layer.ignores ? { ignores: layer.ignores } : {}),
    rules: {
      // The base rule is off everywhere; the TS-aware one understands
      // `import type`, which the base rule does not.
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": compose(...layer.restrictions),
    },
  })),
]);

export default eslintConfig;