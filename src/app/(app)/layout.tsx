import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { gateway } from "@/lib/gateway";
import { AuthProvider } from "@/lib/auth/AuthContext";
import { Sidebar } from "@/components/nav/Sidebar";
import { BackgroundWash } from "@/components/ui";
import { ROLE_COLORS } from "@/lib/repositories/types";

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

  /*
   * Seeds the sidebar's unread badge.
   *
   * Read here so the badge is correct on first paint rather than appearing a
   * moment later, and so a signed-in user with unread notifications sees them
   * without opening the page — which was the whole complaint.
   *
   * One indexed COUNT (Notification has @@index([userId, read])), and it fails
   * soft: a notification badge is never worth 500ing the entire shell over.
   */
  const unreadNotifications = await gateway.notifications
    .unreadCount()
    .catch(() => 0);

  return (
    <AuthProvider initialUser={session.user}>
      {/*
        Role-tinted wash, matching mobile's per-role OrbBackground. Rendered
        once in the shell rather than per screen — mobile repeats it in 25
        files, which is duplication we don't need to port along with the look.
      */}
      <BackgroundWash color={ROLE_COLORS[session.user.role]} />
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar
          user={session.user}
          unreadNotifications={unreadNotifications}
        />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </AuthProvider>
  );
}
