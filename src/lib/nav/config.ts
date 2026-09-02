/**
 * Role-aware navigation.
 *
 * Ported from the five mobile tab navigators (BusinessNavigator,
 * CustomerNavigator, DigitalProviderNavigator, LocalProviderNavigator,
 * AdminNavigator). Each role sees a different set of destinations — that is
 * mobile's behaviour, not a web invention.
 *
 * Mobile's bottom tab bar becomes a sidebar here, per the platform adaptation
 * table: five items is cramped in a bottom bar but comfortable in a sidebar,
 * so the "shared modal screens" mobile hid behind navigation get promoted to
 * visible secondary nav.
 */
import type * as Icons from "lucide-react";
import type { UserRole } from "@/lib/repositories/types";

/**
 * Names that actually exist in lucide-react.
 *
 * Typed rather than `string` so a typo — or an alias being dropped in a future
 * lucide release — is a build error instead of a silently invisible icon.
 */
export type IconName = keyof typeof Icons;

/**
 * Counts the shell can show against a nav item.
 *
 * Declared here rather than matched on href in the Sidebar, so adding a badge
 * is a config change and the component stays generic. A key with no count
 * supplied renders nothing, which is what an unread-free account should see.
 */
export type NavBadgeKey = "notifications";

export interface NavItem {
  label: string;
  href: string;
  /** Lucide icon name, resolved in the Sidebar component. */
  icon: IconName;
  /** Marks the item active for any nested route under `href`. */
  matchPrefix?: boolean;
  /** Which unread count, if any, this item displays. */
  badge?: NavBadgeKey;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

const DASHBOARD: NavItem = {
  label: "Dashboard",
  href: "/dashboard",
  icon: "LayoutDashboard",
};

const MESSAGES: NavItem = {
  label: "Messages",
  href: "/messages",
  icon: "MessageSquare",
  matchPrefix: true,
};

const NOTIFICATIONS: NavItem = {
  label: "Notifications",
  href: "/notifications",
  icon: "Bell",
  badge: "notifications",
};

const PROFILE: NavItem = {
  label: "Profile",
  href: "/profile",
  icon: "User",
};

const SETTINGS: NavItem = {
  label: "Settings",
  href: "/settings",
  icon: "Settings",
  matchPrefix: true,
};

/** Reachable from every role — mobile's shared stack screens. */
const SHARED_SECONDARY: NavItem[] = [
  { label: "Referrals", href: "/referrals", icon: "Gift" },
  SETTINGS,
];

const NAV_BY_ROLE: Record<UserRole, NavSection[]> = {
  business: [
    {
      items: [
        DASHBOARD,
        {
          label: "Post requirement",
          href: "/requirements/new",
          icon: "CirclePlus",
        },
        {
          label: "My requirements",
          href: "/requirements",
          icon: "ClipboardList",
          matchPrefix: true,
        },
        { label: "Find providers", href: "/search", icon: "Search" },
        MESSAGES,
      ],
    },
    {
      title: "Account",
      items: [NOTIFICATIONS, PROFILE, ...SHARED_SECONDARY],
    },
  ],

  customer: [
    {
      items: [
        { label: "Home", href: "/dashboard", icon: "House" },
        { label: "Discover", href: "/search", icon: "Search" },
        {
          label: "Post requirement",
          href: "/requirements/new",
          icon: "CirclePlus",
        },
        {
          label: "Bookings",
          href: "/bookings",
          icon: "CalendarCheck",
          matchPrefix: true,
        },
        MESSAGES,
      ],
    },
    {
      title: "Account",
      items: [NOTIFICATIONS, PROFILE, ...SHARED_SECONDARY],
    },
  ],

  digital: [
    {
      items: [
        DASHBOARD,
        { label: "Find work", href: "/requirements", icon: "Briefcase", matchPrefix: true },
        { label: "Earnings", href: "/earnings", icon: "Wallet" },
        { label: "Portfolio", href: "/portfolio", icon: "Image" },
        MESSAGES,
      ],
    },
    {
      title: "Grow",
      items: [
        { label: "Analytics", href: "/analytics", icon: "TrendingUp" },
        { label: "Availability", href: "/availability", icon: "CalendarDays" },
        { label: "Subscription", href: "/subscription", icon: "Sparkles" },
      ],
    },
    {
      title: "Account",
      items: [NOTIFICATIONS, PROFILE, ...SHARED_SECONDARY],
    },
  ],

  local: [
    {
      items: [
        DASHBOARD,
        { label: "Find work", href: "/requirements", icon: "Briefcase", matchPrefix: true },
        {
          label: "Bookings",
          href: "/bookings",
          icon: "CalendarCheck",
          matchPrefix: true,
        },
        MESSAGES,
      ],
    },
    {
      title: "Grow",
      items: [
        { label: "Earnings", href: "/earnings", icon: "Wallet" },
        { label: "Analytics", href: "/analytics", icon: "TrendingUp" },
        { label: "Availability", href: "/availability", icon: "CalendarDays" },
        { label: "Subscription", href: "/subscription", icon: "Sparkles" },
      ],
    },
    {
      title: "Account",
      items: [NOTIFICATIONS, PROFILE, ...SHARED_SECONDARY],
    },
  ],

  admin: [
    {
      items: [
        { label: "Overview", href: "/admin", icon: "LayoutDashboard" },
        { label: "Users", href: "/admin/users", icon: "Users" },
        { label: "Disputes", href: "/admin/disputes", icon: "Scale" },
        {
          label: "Verification",
          href: "/admin/verification",
          icon: "ShieldCheck",
        },
        { label: "Moderation", href: "/admin/moderation", icon: "Flag" },
      ],
    },
    {
      title: "Platform",
      items: [
        { label: "Revenue", href: "/admin/revenue", icon: "IndianRupee" },
        { label: "Fraud", href: "/admin/fraud", icon: "TriangleAlert" },
        { label: "Feature flags", href: "/admin/flags", icon: "ToggleLeft" },
        { label: "Audit log", href: "/admin/audit", icon: "ScrollText" },
      ],
    },
    {
      title: "Account",
      items: [NOTIFICATIONS, PROFILE, SETTINGS],
    },
  ],
};

export function navForRole(role: UserRole): NavSection[] {
  return NAV_BY_ROLE[role];
}

/** Where each role lands after sign-in. */
export function homeForRole(role: UserRole): string {
  return role === "admin" ? "/admin" : "/dashboard";
}

/**
 * Marks exactly one nav item active for a given path.
 *
 * A plain per-item check lit up two items at once on /requirements/new — the
 * exact match on "Post requirement" and the prefix match on "My requirements".
 * That renders two `aria-current="page"` elements, which is invalid and makes
 * a screen reader announce two current pages. Resolving against the whole nav
 * and preferring the LONGEST matching href fixes it structurally, so future
 * nested routes can't reintroduce it.
 */
export function activeHref(pathname: string, sections: NavSection[]): string | null {
  let best: string | null = null;

  for (const section of sections) {
    for (const item of section.items) {
      const matches = item.matchPrefix
        ? pathname === item.href || pathname.startsWith(`${item.href}/`)
        : pathname === item.href;
      if (!matches) continue;
      if (best === null || item.href.length > best.length) best = item.href;
    }
  }

  return best;
}
