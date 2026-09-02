"use client";

/**
 * Role-aware sidebar — the web replacement for mobile's bottom tab bar.
 *
 * On viewports narrower than `lg` it collapses into a slide-over drawer opened
 * from the top bar, rather than reproducing a bottom tab bar, since a pointer
 * and keyboard interface reads a vertical list more naturally.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import {
  activeHref,
  navForRole,
  type IconName,
  type NavBadgeKey,
} from "@/lib/nav/config";
import { callGateway } from "@/lib/gateway/client";
import { ROLE_COLORS, ROLE_LABELS, type User } from "@/lib/repositories/types";
import { Avatar, Button, cn } from "@/components/ui";

/** How often the shell refreshes its unread count. */
const NOTIFICATION_POLL_MS = 60_000;

/**
 * Keeps the sidebar's unread count fresh.
 *
 * Seeded from the server render so the badge is already correct on first paint.
 * The count is fetched in the layout rather than here, which is why there is no
 * empty-then-populated flicker on every navigation.
 *
 * Polling follows the same rules the chat thread established: self-scheduling
 * rather than setInterval, so a slow server cannot stack requests, and skipped
 * while the tab is hidden, so a tab left open all day costs nothing. Sixty
 * seconds — this is a badge, not a conversation.
 */
function useUnreadNotifications(initial: number): number {
  const [count, setCount] = useState(initial);
  const [seed, setSeed] = useState(initial);

  /*
   * Re-seed when a navigation brings a newer server count.
   *
   * Adjusted during render rather than from an effect: this is React's
   * documented way to reset state from a prop, and it avoids the extra
   * commit-then-re-render an effect would cost on every page change.
   */
  if (seed !== initial) {
    setSeed(initial);
    setCount(initial);
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(() => void poll(), NOTIFICATION_POLL_MS);
    };

    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }
      try {
        const next = await callGateway<number>("notifications.unreadCount");
        if (!cancelled && typeof next === "number") setCount(next);
      } catch {
        // A failed count is not worth surfacing. The badge holds its last known
        // value until a later poll succeeds.
      }
      schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return count;
}

function Icon({ name, className }: { name: IconName; className?: string }) {
  // `name` is `keyof typeof Icons`, so a typo in nav/config.ts is a type error
  // rather than a silently missing icon.
  const Cmp = Icons[name] as React.ComponentType<{ className?: string }>;
  return <Cmp className={className} />;
}

function NavLinks({
  user,
  badges,
  onNavigate,
}: {
  user: User;
  badges: Partial<Record<NavBadgeKey, number>>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const sections = navForRole(user.role);
  // Resolved once across the whole nav so exactly one item is marked current.
  const current = activeHref(pathname, sections);

  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {sections.map((section, i) => (
        <div key={section.title ?? i}>
          {section.title ? (
            <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              {section.title}
            </p>
          ) : null}
          <ul className="space-y-1">
            {section.items.map((item) => {
              const active = item.href === current;
              const badgeCount = item.badge ? (badges[item.badge] ?? 0) : 0;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    /*
                     * The current item is pressed INTO the surface — the
                     * neumorphic idiom for selection — but depth is not left to
                     * carry it alone. A soft inset is a weak signal on its own
                     * and disappears entirely for anyone who cannot resolve low
                     * contrast, so colour and weight change with it, and
                     * aria-current above states it outright. Three channels, not
                     * one. --primary measures 4.50:1 on this page, so the text
                     * colour is legible by itself.
                     */
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                      active
                        ? "nm-pressed font-medium text-[var(--primary)]"
                        : "text-[var(--foreground)] hover:nm-raised-sm",
                    )}
                  >
                    <Icon name={item.icon} className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {badgeCount > 0 ? (
                      /*
                       * Announced as text, not just colour: the count is the
                       * whole point of the badge, and a coloured dot conveys
                       * nothing to a screen reader. Capped so a long-neglected
                       * account cannot widen the nav.
                       */
                      <span
                        className="ml-auto min-w-5 shrink-0 rounded-full bg-[var(--primary)] px-1.5 py-0.5 text-center text-xs font-medium tabular-nums text-[var(--primary-foreground)]"
                        aria-label={`${badgeCount} unread`}
                      >
                        {badgeCount > 99 ? "99+" : badgeCount}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter({ user }: { user: User }) {
  const { signOut, busy } = useAuth();

  return (
    // Hairline dropped: on a same-colour surface the extrusion is the edge, and
    // a hard 1px rule reads as a seam through it. Spacing separates instead.
    <div className="p-3">
      <div className="flex items-center gap-3 rounded-xl px-2 py-2">
        <Avatar name={user.name} src={user.avatarUrl} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p
            className="truncate text-xs"
            style={{ color: ROLE_COLORS[user.role] }}
          >
            {ROLE_LABELS[user.role]}
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 w-full justify-start"
        onClick={() => void signOut()}
        disabled={busy}
      >
        <Icons.LogOut className="h-4 w-4" />
        Sign out
      </Button>
    </div>
  );
}

export function Sidebar({
  user,
  unreadNotifications = 0,
}: {
  user: User;
  /** Server-rendered seed for the notifications badge. */
  unreadNotifications?: number;
}) {
  const [open, setOpen] = useState(false);
  const unread = useUnreadNotifications(unreadNotifications);
  const badges = { notifications: unread };

  // The drawer closes from the link's own onClick (see NavLinks) and from the
  // backdrop. An effect keyed on pathname would do the same thing via a
  // cascading render, so it isn't used.

  return (
    <>
      {/* Mobile top bar */}
      <header className="flex items-center gap-3 nm-raised px-4 py-3 lg:hidden">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open navigation"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Icons.Menu className="h-5 w-5" />
        </Button>
        <span className="font-semibold">SRN</span>
      </header>

      {/* Drawer backdrop */}
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}

      <aside
        className={cn(
          // `nm-raised` replaces the right-hand hairline: the panel casts its
          // own edge. The up-left highlight falls off-screen, which is correct
          // for a panel flush to the viewport edge.
          "z-50 flex w-64 shrink-0 flex-col nm-raised",
          "fixed inset-y-0 left-0 transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between gap-2 px-5 py-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg nm-raised-sm bg-[var(--primary)] text-[var(--primary-foreground)]">
              S
            </span>
            SRN
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <Icons.X className="h-5 w-5" />
          </Button>
        </div>

        <NavLinks
          user={user}
          badges={badges}
          onNavigate={() => setOpen(false)}
        />
        <SidebarFooter user={user} />
      </aside>
    </>
  );
}
