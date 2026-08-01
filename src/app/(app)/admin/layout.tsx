import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Admin section guard.
 *
 * This redirect is a COURTESY, not the security boundary. Every admin gateway
 * operation is `access: "admin"` and re-checks server-side before its handler
 * runs, and the privileged repository methods assert on the actor on top of
 * that. If this layout were deleted tomorrow, a non-admin hitting /admin/users
 * would see an empty shell and every data call would still be refused.
 *
 * Stated explicitly because a layout check that *looks* like a gate is exactly
 * the thing someone later trusts as one.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");

  return <>{children}</>;
}
