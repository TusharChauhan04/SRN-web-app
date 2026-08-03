import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import fs from "node:fs";
import path from "node:path";
import { LAYERS } from "../eslint.config.mjs";

/**
 * The guardrail the lint config did not have.
 *
 * `eslint.config.mjs` encodes the layering rules that make the database and the
 * providers swappable. Those rules silently switched themselves off THREE times
 * — two flat-config blocks matching the same file and setting the same rule key
 * do not merge, the later one replaces the earlier one — and each time a full
 * `pnpm lint` still passed, because a rule that does not exist reports nothing.
 *
 * So these tests do not read the config. They run ESLint against source that
 * VIOLATES each rule and assert it actually reports. Delete a restriction and a
 * test here fails.
 */

const ROOT = path.resolve(__dirname, "..");

const eslint = new ESLint({ cwd: ROOT });

/**
 * Lints a string as if it were a file at `filePath`, without writing anything.
 *
 * `lintText` applies the same config resolution a real file would get, so this
 * tests the actual layer globs rather than a simulation of them.
 */
async function restrictedImportErrors(
  filePath: string,
  source: string,
): Promise<string[]> {
  const [result] = await eslint.lintText(source, {
    filePath: path.join(ROOT, filePath),
    warnIgnored: false,
  });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId?.includes("no-restricted-imports"))
    .map((m) => m.message);
}

describe("layering rules are actually enforced", () => {
  /**
   * Each case is a real violation someone could plausibly commit.
   *
   * The `import` must be used, or `no-unused-vars` is the only thing that
   * fires and the test would pass for the wrong reason.
   */
  const violations: { layer: string; file: string; code: string }[] = [
    {
      layer: "ui",
      file: "src/app/(app)/probe/page.tsx",
      code: `import { repo } from "@/lib/repositories";\nexport default function P() { return String(repo); }`,
    },
    {
      layer: "ui — services",
      file: "src/app/(app)/probe/page.tsx",
      code: `import * as s from "@/lib/services/admin.service";\nexport default function P() { return String(s); }`,
    },
    {
      layer: "ui — prisma",
      file: "src/components/Probe.tsx",
      code: `import { PrismaClient } from "@prisma/client";\nexport const x = new PrismaClient();`,
    },
    {
      layer: "ui — server providers",
      file: "src/app/(app)/probe/page.tsx",
      code: `import { storageProvider } from "@/lib/providers/storage/index.server";\nexport default function P() { return String(storageProvider); }`,
    },
    {
      /*
       * THE ONE THAT REGRESSED. A service importing Prisma was permitted for an
       * unknown length of time because a later `src/**` block replaced the
       * block that forbade it. The swap boundary was a convention again.
       */
      layer: "service — prisma (the regression)",
      file: "src/lib/services/probe.service.ts",
      code: `import { prisma } from "@/lib/db/client";\nexport const x = prisma;`,
    },
    {
      layer: "service — prisma client package",
      file: "src/lib/services/probe.service.ts",
      code: `import { PrismaClient } from "@prisma/client";\nexport const x = new PrismaClient();`,
    },
    {
      layer: "service — provider SDK",
      file: "src/lib/services/probe.service.ts",
      code: `import Razorpay from "razorpay";\nexport const x = Razorpay;`,
    },
    {
      layer: "repository interfaces — prisma",
      file: "src/lib/repositories/probe.ts",
      code: `import { prisma } from "@/lib/db/client";\nexport const x = prisma;`,
    },
    {
      layer: "gateway — repositories",
      file: "src/lib/gateway/operations/probe.ts",
      code: `import { repo } from "@/lib/repositories";\nexport const x = repo;`,
    },
    {
      layer: "api route — repositories",
      file: "src/app/api/v1/probe/route.ts",
      code: `import { repo } from "@/lib/repositories";\nexport const x = repo;`,
    },
    {
      layer: "client-lib — repositories",
      file: "src/lib/auth/Probe.tsx",
      code: `import { repo } from "@/lib/repositories";\nexport const x = repo;`,
    },
    {
      /*
       * The browser layer must carry the browser rule. This layer exists for a
       * "use client" component, and was created with every restriction EXCEPT
       * the one that keeps server-only modules out of the client bundle.
       */
      layer: "client-lib — server providers",
      file: "src/lib/auth/Probe.tsx",
      code: `import { storageProvider } from "@/lib/providers/storage/index.server";\nexport const x = storageProvider;`,
    },
    {
      /*
       * A `.tsx` in a directory whose layer glob was `.ts`-only. The sibling
       * `ignores` are extension-agnostic, so such a file was carved out of the
       * catch-all without being covered by its own layer — no restrictions.
       */
      layer: "tsx files do not fall through the globs",
      file: "src/lib/providers/Probe.tsx",
      code: `import { repo } from "@/lib/repositories";\nexport const x = repo;`,
    },
    {
      layer: "providers — reaching back up to services",
      file: "src/lib/providers/probe.ts",
      code: `import * as s from "@/lib/services/admin.service";\nexport const x = s;`,
    },
    {
      layer: "proxy — security decisions",
      file: "src/proxy.ts",
      code: `import { gateway } from "@/lib/gateway";\nexport const x = gateway;`,
    },
    {
      layer: "firebase SDK outside the auth provider",
      file: "src/lib/services/probe.service.ts",
      code: `import admin from "firebase-admin";\nexport const x = admin;`,
    },
  ];

  for (const { layer, file, code } of violations) {
    it(`reports: ${layer}`, async () => {
      const errors = await restrictedImportErrors(file, code);
      expect(
        errors,
        `Expected a no-restricted-imports error for ${file}. ` +
          `Getting none means the rule is not reaching this file — which is ` +
          `exactly how this regressed before.`,
      ).not.toHaveLength(0);
    });
  }

  it("allows the exceptions that are deliberate", async () => {
    // Browser sign-in genuinely cannot round-trip through a server gateway.
    expect(
      await restrictedImportErrors(
        "src/app/(auth)/login/Probe.tsx",
        `import { authClient } from "@/lib/providers/auth/client";\nexport const x = authClient;`,
      ),
    ).toHaveLength(0);

    // The UI legitimately needs role constants and types.
    expect(
      await restrictedImportErrors(
        "src/app/(app)/probe/page.tsx",
        `import { ROLE_LABELS } from "@/lib/repositories/types";\nexport default function P() { return String(ROLE_LABELS); }`,
      ),
    ).toHaveLength(0);

    // Prisma is allowed in exactly one place.
    expect(
      await restrictedImportErrors(
        "src/lib/repositories/prisma/probe.ts",
        `import { prisma } from "@/lib/db/client";\nexport const x = prisma;`,
      ),
    ).toHaveLength(0);

    // The health check pings the repository by design — see its own header.
    expect(
      await restrictedImportErrors(
        "src/app/api/healthz/route.ts",
        `import { repo } from "@/lib/repositories";\nexport const x = repo;`,
      ),
    ).toHaveLength(0);
  });
});

describe("no source file falls through the layer globs", () => {
  /**
   * The failure mode this catches is a file matching NO layer and therefore
   * carrying no restrictions at all — which is what happened to `core.ts`,
   * `context.ts` and everything under `src/app/api/`. They were `ignores`d out
   * of the block that covered them and no other block picked them up, so those
   * files — including the payment webhook and the gateway's own access check —
   * had unrestricted reach into every layer.
   */
  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) sourceFiles(full, acc);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        acc.push(full);
      }
    }
    return acc;
  }

  it("covers hypothetical .tsx files in every layer directory", async () => {
    /*
     * The sweep below only sees files that exist today, which is exactly why
     * the `.tsx` fall-through was invisible to it: no `.tsx` happened to live
     * in those directories yet, so the config's claim that "every file under
     * src/ matches exactly one layer" was true of the tree and false of the
     * rules. This checks the rules.
     */
    const hypothetical = [
      "src/app/api/v1/x/route.tsx",
      "src/app/api/healthz/helper.tsx",
      "src/lib/providers/storage/x.tsx",
      "src/lib/repositories/prisma/x.tsx",
      "src/lib/db/x.tsx",
      "src/lib/gateway/x.tsx",
    ];

    const uncovered: string[] = [];
    for (const rel of hypothetical) {
      const config = await eslint.calculateConfigForFile(path.join(ROOT, rel));
      const rule = config.rules?.["@typescript-eslint/no-restricted-imports"];
      const options = Array.isArray(rule) ? rule[1] : undefined;
      const count =
        (options?.paths?.length ?? 0) + (options?.patterns?.length ?? 0);
      if (count === 0) uncovered.push(rel);
    }

    expect(
      uncovered,
      "A .tsx file added here would carry NO import restrictions:\n" +
        uncovered.join("\n"),
    ).toEqual([]);
  });

  it("gives every file under src/ a non-empty restriction set", async () => {
    const files = sourceFiles(path.join(ROOT, "src"));
    expect(files.length).toBeGreaterThan(50);

    const uncovered: string[] = [];
    for (const file of files) {
      const config = await eslint.calculateConfigForFile(file);
      const rule = config.rules?.["@typescript-eslint/no-restricted-imports"];
      const options = Array.isArray(rule) ? rule[1] : undefined;
      const count =
        (options?.paths?.length ?? 0) + (options?.patterns?.length ?? 0);
      if (count === 0) uncovered.push(path.relative(ROOT, file));
    }

    expect(
      uncovered,
      "These files match no layer, so they carry no import restrictions:\n" +
        uncovered.join("\n"),
    ).toEqual([]);
  });

  it("keeps the layer list and the config in agreement", () => {
    // A layer with no restrictions would silently cover files with nothing.
    for (const layer of LAYERS) {
      expect(layer.restrictions.length, `layer "${layer.name}"`).toBeGreaterThan(
        0,
      );
    }
  });
});