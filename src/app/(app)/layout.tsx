import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { AuthProvider } from "@/lib/auth/AuthContext";
import { Sidebar } from "@/components/nav/Sidebar";

/**
 * Authenticated shell.
 *
 * This layout is the real gate for every page beneath it. `src/proxy.ts`
 * handles the cheap pre-render redirect, but it never runs for /api/* and only
 * checks that a cookie exists — so the authoritative check lives here, and in
 * the gateway for data.
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getSession();

  if (!session) redirect("/login");
  if (!session.user) redirect("/onboarding");

  return (
    <AuthProvider initialUser={session.user}>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar user={session.user} />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </AuthProvider>
  );
}
