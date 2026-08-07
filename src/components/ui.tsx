/**
 * Shared UI primitives, the web counterpart of mobile's src/components/ui.tsx.
 *
 * Everything here is styled with the design tokens ported from
 * src/constants/colors.ts, so the web app inherits the mobile visual identity
 * rather than looking like a default Next.js starter.
 */
import { isSafeExternalUrl } from "@/lib/gateway/schemas";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ROLE_COLORS, ROLE_LABELS, type UserRole } from "@/lib/repositories/types";

/**
 * Renders a user-supplied link only if its scheme is safe, else `undefined`.
 *
 * The gateway refuses anything that is not http(s) on the way IN, but that does
 * nothing for rows written before that rule existed, or by a seed, an import,
 * or a future code path that forgets. An `href` is the point where a
 * `javascript:` URI actually becomes script execution, so the check is repeated
 * here — at the sink, where it cannot be bypassed by any writer.
 *
 * Returning `undefined` makes React drop the attribute entirely: the text stays
 * visible, the link is inert.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return isSafeExternalUrl(url) ? url : undefined;
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ─────────────────────────── Button ───────────────────────────

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

/*
 * Primary, secondary and danger keep a SOLID fill on purpose.
 *
 * The rest of this design is neumorphic: same colour as the page, raised only
 * by shadow. That gives a control roughly 1.2:1 against its background, and
 * WCAG 2.1 SC 1.4.11 wants 3:1 for a UI boundary — so a purely extruded button
 * is one a low-vision user cannot find. Keeping a filled ground on the actions
 * that commit something (pay, submit, delete) is what stops the style from
 * eating the affordance. `outline` and `ghost` may go soft because they are
 * always secondary to one of these.
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--primary)] text-[var(--primary-foreground)] nm-raised-sm hover:opacity-90",
  secondary:
    "bg-[var(--secondary)] text-[var(--secondary-foreground)] nm-raised-sm hover:opacity-90",
  outline:
    "border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] nm-raised-sm",
  ghost: "bg-transparent text-[var(--foreground)] hover:nm-raised-sm",
  danger:
    "bg-[var(--destructive)] text-[var(--destructive-foreground)] nm-raised-sm hover:opacity-90",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

/*
 * `active:nm-pressed` is the extrusion inverting under the cursor — the press
 * feedback the fill alone no longer gives. `disabled:nm-flat` drops the shadow
 * entirely, because a dimmed button that still stands proud still reads as
 * pressable; going flat is what actually says "inert".
 */
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:nm-pressed disabled:nm-flat disabled:pointer-events-none disabled:opacity-50";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(
        BUTTON_BASE,
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <Link
      className={cn(
        BUTTON_BASE,
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

// ─────────────────────────── Surfaces ───────────────────────────

export function Card({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        // No border: the extrusion IS the edge. `nm-raised` supplies the
        // background, which is deliberately the same colour as the page.
        "rounded-2xl nm-raised text-[var(--card-foreground)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/**
 * The role-tinted background wash, ported from mobile's `OrbBackground`
 * (mobile src/components/ui.tsx:247).
 *
 * Mobile draws two soft radial `LinearGradient` circles bleeding off the
 * corners — `[roleColor + "10", "transparent"]` top-right and
 * `[teal + "08", "transparent"]` bottom-left, 280px, radius 140. Twenty-five
 * mobile files use it and it is most of why the app reads as tinted per role
 * rather than flat white. It was listed as "Port → CSS linear-gradient" in the
 * migration plan and then not actually done, so every web screen was flat.
 *
 * `radial-gradient` is the honest equivalent of a circular RN gradient; a
 * literal `linear-gradient` would give a hard-edged band. The hex suffixes are
 * the same 8-bit alphas mobile uses (10 ≈ 6%, 08 ≈ 3%).
 *
 * `aria-hidden` and `pointer-events-none`: this is decoration, and it must not
 * appear in the accessibility tree or intercept a click.
 */
export function BackgroundWash({
  color = "var(--primary)",
  color2 = "var(--accent, #0d9488)",
}: {
  color?: string;
  color2?: string;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/*
        Lifted from mobile's 6%/3% to 10%/5%. Those alphas were picked against a
        near-white page; the neumorphic base is a mid-tone, so the same tint has
        far less room to read against it and the per-role wash — the entire
        point of this component — had all but vanished. Raised to the level
        where the role is still legible at a glance without competing with the
        shadows that do the structural work.
      */}
      <div
        className="absolute -top-[100px] -right-[70px] h-[280px] w-[280px] rounded-full"
        style={{
          background: `radial-gradient(circle, color-mix(in srgb, ${color} 10%, transparent) 0%, transparent 70%)`,
        }}
      />
      <div
        className="absolute -bottom-[80px] -left-[70px] h-[280px] w-[280px] rounded-full"
        style={{
          background: `radial-gradient(circle, color-mix(in srgb, ${color2} 5%, transparent) 0%, transparent 70%)`,
        }}
      />
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

// ─────────────────────────── Form fields ───────────────────────────

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-[var(--destructive-text)]" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-[var(--muted-foreground)]">{hint}</p>
      ) : null}
    </div>
  );
}

/*
 * Fields are INSET rather than raised — the shadow runs the other way, which is
 * the cue that this is something you type into rather than press.
 *
 * There is deliberately NO `outline-none` here, and it must not come back.
 *
 * It was here, with a comment claiming the global `:focus-visible` rule would
 * still paint over it. That is false. Tailwind declares
 * `@layer theme, base, components, utilities`, `.outline-none` lands in
 * `utilities` and the `:focus-visible` rule lives in `base`, and a later layer
 * wins over an earlier one no matter the specificity. So `outline-style: none`
 * silently beat the focus ring on every Input, Textarea and Select in the app —
 * a keyboard user had no visible focus at all (WCAG 2.4.7). Adding
 * `focus-visible:outline-2` alongside would NOT have fixed it either, because
 * that reads --tw-outline-style, which outline-none has already pinned to none.
 * Deleting it is the fix.
 */
const CONTROL_BASE =
  "w-full rounded-xl nm-inset px-3 py-2 text-sm transition placeholder:text-[var(--muted-foreground)] disabled:opacity-50";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(CONTROL_BASE, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(CONTROL_BASE, "min-h-24", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(CONTROL_BASE, "h-10", className)} {...props} />;
}

// ─────────────────────────── Feedback ───────────────────────────

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

/*
 * Badges keep a real tinted fill and take NO extrusion.
 *
 * They are the only thing on screen carrying entity status — open, disputed,
 * rejected — so they have to stay legible rather than blend into the surface
 * they sit on. Two consequences, both measured rather than guessed:
 *
 *  - Text darkened one step (700 → 800) and the tint lifted 15% → 18%. On the
 *    old near-white page the 700 weights sat at 4.30–5.11:1; against the
 *    mid-tone page they fell to 3.62–4.28:1, i.e. under the 4.5:1 AA floor at
 *    the 12px these render at. These values measure 5.04–5.31:1.
 *  - No `nm-raised-sm`. A 4px/8px shadow on a 20px-tall pill reads as smudge,
 *    not relief, and muddies the tint that does the actual work.
 */
const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-[var(--muted)] text-[var(--muted-foreground)]",
  success: "bg-emerald-500/18 text-emerald-800",
  warning: "bg-amber-500/18 text-amber-800",
  danger: "bg-red-500/18 text-red-800",
  info: "bg-sky-500/18 text-sky-800",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Maps the status strings used across entities to a consistent tone. */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case "open":
    case "confirmed":
    case "active":
    case "approved":
    case "accepted":
      return "success";
    case "pending":
    case "in_progress":
    case "under_review":
    case "shortlisted":
      return "warning";
    case "cancelled":
    case "rejected":
    case "disputed":
    case "withdrawn":
      return "danger";
    case "completed":
    case "resolved":
      return "info";
    default:
      return "neutral";
  }
}

/** Turns snake_case statuses into readable labels. */
export function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: ROLE_COLORS[role] }}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

export function Avatar({
  name,
  src,
  size = 40,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (src) {
    // Avatar URLs are user-supplied and arbitrary-origin; next/image would
    // need every host allow-listed up front, so a plain img is correct here.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full nm-raised-sm object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full nm-raised-sm bg-[var(--primary)] font-medium text-[var(--primary-foreground)]"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials || "?"}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    // A dashed border has no neumorphic equivalent; an inset well is the
    // native way to say "this space is empty" in this system.
    <div className="flex flex-col items-center justify-center rounded-2xl nm-inset px-6 py-14 text-center">
      <h3 className="text-base font-medium">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-[var(--muted-foreground)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

export function Alert({
  tone = "danger",
  children,
}: {
  tone?: "danger" | "warning" | "info";
  children: ReactNode;
}) {
  // Measured on the new page colour: 4.55 / 5.28 / 5.51 : 1. The border is
  // kept — an alert is exactly the thing that must not dissolve into the page.
  const tones = {
    danger: "border-red-500/40 bg-red-500/10 text-red-700",
    warning: "border-amber-500/40 bg-amber-500/10 text-amber-800",
    info: "border-sky-500/40 bg-sky-500/10 text-sky-800",
  };
  return (
    <div
      role="alert"
      className={cn(
        "rounded-xl border nm-raised-sm px-4 py-3 text-sm",
        tones[tone],
      )}
    >
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-sm text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? (
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">{hint}</p>
      ) : null}
    </Card>
  );
}

// ─────────────────────────── Formatting ───────────────────────────

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatCurrency(amount: number): string {
  return INR.format(amount);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatRelative(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.round(diffMs / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;

  return formatDate(d);
}
