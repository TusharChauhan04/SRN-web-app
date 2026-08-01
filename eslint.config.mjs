import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma's generated client — not ours to lint.
    "src/generated/**",
  ]),

  /**
   * Enforces the data-layer boundary that DATABASE.md describes.
   *
   * Without this the rule is only a convention, and one stray import in a
   * client component pulls PrismaClient into the browser bundle. Only the
   * concrete implementations under src/lib/repositories/prisma/ (and the seed)
   * may reach for Prisma directly.
   */
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/repositories/prisma/**",
      "src/lib/db/**",
      "src/generated/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/generated/prisma", "@/generated/prisma/*"],
              message:
                "Import domain types from @/lib/repositories/types instead. Prisma types are confined to src/lib/repositories/prisma/ so the database stays swappable — see DATABASE.md.",
            },
            {
              group: ["@/lib/db", "@/lib/db/*"],
              message:
                "Do not use PrismaClient directly. Go through the repository interfaces: import { repo } from '@/lib/repositories'. See DATABASE.md.",
            },
            {
              group: ["@prisma/client"],
              message:
                "Do not import @prisma/client outside src/lib/repositories/prisma/. See DATABASE.md.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
