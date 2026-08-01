import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gateway, GatewayError } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import { isProviderRole } from "@/lib/repositories/types";
import { Alert, PageHeader } from "@/components/ui";
import { AvailabilityEditor } from "./AvailabilityEditor";

export const metadata = { title: "Availability — SRN" };

export type AvailabilityState = { error?: string; saved?: boolean };

async function saveHours(
  _prev: AvailabilityState,
  formData: FormData,
): Promise<AvailabilityState> {
  "use server";

  // The editor submits the whole week, so the repository can replace it
  // wholesale rather than diffing.
  const hours = Array.from({ length: 7 }, (_, day) => ({
    dayOfWeek: day,
    startTime: String(formData.get(`start-${day}`) ?? "09:00"),
    endTime: String(formData.get(`end-${day}`) ?? "17:00"),
    isEnabled: formData.get(`enabled-${day}`) === "on",
  }));

  try {
    await gateway.availability.setHours({ hours });
  } catch (err) {
    if (err instanceof GatewayError) return { error: err.message };
    throw err;
  }

  revalidatePath("/availability");
  return { saved: true };
}

async function blockDate(formData: FormData): Promise<void> {
  "use server";
  const date = String(formData.get("date") ?? "");
  if (!date) return;
  await gateway.availability
    .block({ date, reason: String(formData.get("reason") ?? "") || undefined })
    .catch(() => {});
  revalidatePath("/availability");
}

async function unblockDate(formData: FormData): Promise<void> {
  "use server";
  await gateway.availability
    .unblock({ date: String(formData.get("date") ?? "") })
    .catch(() => {});
  revalidatePath("/availability");
}

/** Ported from mobile src/screens/shared/AvailabilityScreen.tsx. */
export default async function AvailabilityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isProviderRole(user.role)) redirect("/dashboard");

  const availability = await gateway.availability.mine();

  return (
    <>
      <PageHeader
        title="Availability"
        description="Your working week, and any days you're not taking work."
      />

      <div className="mb-6">
        {/*
          Recorded rather than hidden: there is no per-provider timezone column
          yet, so these times are interpreted as UTC for everyone. Tracked in
          WEB_MIGRATION_PLAN.md — mobile has the same limitation.
        */}
        <Alert tone="info">
          Times are currently interpreted as UTC. Per-provider timezones
          aren&apos;t supported yet, so set hours accordingly if you&apos;re not
          on UTC.
        </Alert>
      </div>

      <AvailabilityEditor
        workingHours={availability.workingHours}
        blockedDates={availability.blockedDates}
        saveAction={saveHours}
        blockAction={blockDate}
        unblockAction={unblockDate}
      />
    </>
  );
}
