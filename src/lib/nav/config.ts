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
import type { UserRole } from "@/lib/repositories/types";

export interface NavItem {
  label: string;
  href: string;
  /** Lucide icon name, resolved in the Sidebar component. */
  icon: string;
  /** Marks the item active for any nested route under `href`. */
  matchPrefix?: boolean;
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
          icon: "PlusCircle",
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
        { label: "Home", href: "/dashboard", icon: "Home" },
        { label: "Discover", href: "/search", icon: "Search" },
        {
          label: "Post requirement",
          href: "/requirements/new",
          icon: "PlusCircle",
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
        { label: "Fraud", href: "/admin/fraud", icon: "AlertTriangle" },
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

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchPrefix) {
    // Guard against /admin matching /admin/users as a prefix collision.
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }
  return pathname === item.href;
}
