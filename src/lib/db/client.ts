import "server-only";

import { PrismaClient } from "@/generated/prisma";

/**
 * Prisma client singleton.
 *
 * This module is the ONLY place in the app allowed to construct a PrismaClient,
 * and it should only ever be imported by files under src/lib/repositories/prisma/.
 * Feature code (pages, components, route handlers) must go through the repository
 * interfaces instead — see DATABASE.md for why.
 *
 * The global cache prevents Next.js dev-mode hot reload from opening a new
 * connection pool on every recompile.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}