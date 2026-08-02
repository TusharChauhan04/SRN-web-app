import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gateway } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import Link from "next/link";
import { Alert, Button, Card, CardHeader, PageHeader } from "@/components/ui";

export const metadata = { title: "Settings — SRN" };

async function savePrefs(formData: FormData) {
  "use server";
  await gateway.notifications.updatePrefs({
    quotes: formData.get("quotes") === "on",
    bookings: formData.get("bookings") === "on",
    messages: formData.get("messages") === "on",
    email: formData.get("email") === "on",
    marketing: formData.get("marketing") === "on",
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
              {TOGGLES.map((toggle) => (
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
