import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { PhoneVerifyForm } from "./PhoneVerifyForm";

export const metadata = { title: "Verify your phone — SRN" };

/** Ported from mobile src/screens/shared/PhoneVerificationScreen.tsx. */
export default async function PhoneVerificationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <>
      <PageHeader
        title="Phone number"
        description="A verified number makes your profile more trusted."
      />

      {user.phoneVerified ? (
        <Card className="p-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="success">Verified</Badge>
            <span className="font-medium">{user.phone}</span>
          </div>
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            Verifying a different number replaces this one.
          </p>
          <div className="mt-5 border-t border-[var(--border)] pt-5">
            <PhoneVerifyForm currentPhone={user.phone ?? ""} />
          </div>
        </Card>
      ) : (
        <>
          <div className="mb-6">
            <Alert tone="info">
              Your phone number is never shown publicly. It&apos;s used to
              confirm you&apos;re a real person and, later, for booking
              notifications.
            </Alert>
          </div>
          <PhoneVerifyForm currentPhone={user.phone ?? ""} />
        </>
      )}
    </>
  );
}
