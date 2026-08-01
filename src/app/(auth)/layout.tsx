import type { ReactNode } from "react";

/**
 * Centred single-column shell for sign-in and onboarding.
 *
 * Mobile's SplashScreen has no web equivalent — on web the server already knows
 * the session before first paint, so there is nothing to wait on and no splash
 * to show. Recorded in WEB_MIGRATION_PLAN.md.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-[var(--background)] px-4 py-12">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
