import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gateway } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import Link from "next/link";
import { Alert, Button, Card, CardHeader, PageHeader } from "@/components/ui";

export const metadata = { title: "Settings — SRN" };

async function savePrefs(formData: FormData) {
  "use server";

  /*
   * Only send what the form actually rendered.
   *
   * An unchecked checkbox is ABSENT from FormData, which is indistinguishable
   * from a checkbox that was never on the page. The newWork row is only shown
   * to providers, so sending it unconditionally wrote `false` for every
   * business, customer and admin who saved this form — a preference they were
   * never offered and never touched. Roles change here (the admin panel does
   * it, and README §5 tells you to), so that user would later become a
   * provider with the fan-out silently switched off and nothing explaining it.
   *
   * `setPrefs` takes a Partial, so omitting a key leaves it alone. That is
   * already how `push` is handled — it has no toggle and is simply never sent.
   */
  const user = await getCurrentUser();
  const isProvider = user?.role === "digital" || user?.role === "local";

  await gateway.notifications.updatePrefs({
    quotes: formData.get("quotes") === "on",
    bookings: formData.get("bookings") === "on",
    messages: formData.get("messages") === "on",
    email: formData.get("email") === "on",
    marketing: formData.get("marketing") === "on",
    ...(isProvider && { newWork: formData.get("newWork") === "on" }),
  });
  revalidatePath("/settings");
}

const TOGGLES = [
  {
    name: "quotes",
    label: "Quotes",
    hint: "When someone bids on your requirement, or your bid is accepted.",
  },
  {
    name: "bookings",
    label: "Bookings",
    hint: "Status changes on work you're part of.",
  },
  { name: "messages", label: "Messages", hint: "New chat messages." },
  {
    name: "email",
    label: "Email",
    hint: "Send the above to your email address as well.",
  },
  {
    name: "marketing",
    label: "Product updates",
    hint: "Occasional news about SRN. Off by default.",
  },
  {
    name: "newWork",
    label: "New work for you",
    hint: "When someone posts a requirement matching your skills.",
    // Only providers are ever matched by the fan-out, so showing this to a
    // customer would offer a switch that changes nothing.
    providerOnly: true,
  },
] as const;

const ACCOUNT_LINKS = [
  {
    href: "/settings/phone",
    label: "Phone number",
    hint: "Verify your number to build trust with customers.",
  },
  {
    href: "/settings/verification",
    label: "Identity verification",
    hint: "Submit documents to get a verified badge.",
  },
  {
    href: "/settings/data",
    label: "Your data",
    hint: "Download everything we hold, or close your account.",
  },
] as const;

/** Ported from mobile src/screens/shared/SettingsScreen.tsx. */
export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const prefs = await gateway.notifications.getPrefs();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Notification preferences and account controls."
      />

      <div className="space-y-6">
        <form action={savePrefs}>
          <Card>
            <CardHeader
              title="Notifications"
              description="What you want to hear about."
            />
            <div className="space-y-4 p-5">
              {TOGGLES.filter(
                (toggle) =>
                  !("providerOnly" in toggle) ||
                  user.role === "digital" ||
                  user.role === "local",
              ).map((toggle) => (
                <label key={toggle.name} className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    name={toggle.name}
                    defaultChecked={prefs[toggle.name]}
                    className="mt-0.5 h-4 w-4 rounded border-[var(--input)]"
                  />
                  <span>
                    <span className="font-medium">{toggle.label}</span>
                    <span className="block text-[var(--muted-foreground)]">
                      {toggle.hint}
                    </span>
                  </span>
                </label>
              ))}

              <div className="pt-2">
                <Button type="submit">Save preferences</Button>
              </div>
            </div>
          </Card>
        </form>

        <Card>
          <CardHeader
            title="Account"
            description="Verification and your data."
          />
          <ul className="divide-y divide-[var(--border)]">
            {ACCOUNT_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-[var(--muted)]"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{link.label}</span>
                    <span className="block text-sm text-[var(--muted-foreground)]">
                      {link.hint}
                    </span>
                  </span>
                  <span aria-hidden className="text-[var(--muted-foreground)]">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Push notifications"
            description="Browser push is not enabled."
          />
          <div className="p-5">
            {/*
              Deferred deliberately, not forgotten — see WEB_MIGRATION_PLAN.md
              §5. In-app notifications carry full parity without it, and mobile's
              own push registration is best-effort.
            */}
            <Alert tone="info">
              Web push is deferred for now. You&apos;ll still see everything in
              the notifications tab, and by email if you enable it above.
            </Alert>
          </div>
        </Card>
      </div>
    </>
  );
}
