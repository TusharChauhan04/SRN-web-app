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
import { useState } from "react";
import * as Icons from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { isActive, navForRole } from "@/lib/nav/config";
import { ROLE_COLORS, ROLE_LABELS, type User } from "@/lib/repositories/types";
import { Avatar, Button, cn } from "@/components/ui";

function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
    name
  ];
  if (!Cmp) return null;
  return <Cmp className={className} />;
}

function NavLinks({ user, onNavigate }: { user: User; onNavigate?: () => void }) {
  const pathname = usePathname();
  const sections = navForRole(user.role);

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
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                      active
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-medium"
                        : "text-[var(--foreground)] hover:bg-[var(--muted)]",
                    )}
                  >
                    <Icon name={item.icon} className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
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
    <div className="border-t border-[var(--border)] p-3">
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

export function Sidebar({ user }: { user: User }) {
  const [open, setOpen] = useState(false);

  // The drawer closes from the link's own onClick (see NavLinks) and from the
  // backdrop. An effect keyed on pathname would do the same thing via a
  // cascading render, so it isn't used.

  return (
    <>
      {/* Mobile top bar */}
      <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3 lg:hidden">
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
          "z-50 flex w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)]",
          "fixed inset-y-0 left-0 transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)]">
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

        <NavLinks user={user} onNavigate={() => setOpen(false)} />
        <SidebarFooter user={user} />
      </aside>
    </>
  );
}
