import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gateway, GatewayError } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import {
  Avatar,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
} from "@/components/ui";
import { ReferralPanel } from "./ReferralPanel";

export const metadata = { title: "Referrals — SRN" };

export type ReferralState = { error?: string; ok?: string };

async function applyCode(
  _prev: ReferralState,
  formData: FormData,
): Promise<ReferralState> {
  "use server";
  try {
    await gateway.referrals.apply({
      code: String(formData.get("code") ?? "").toUpperCase(),
    });
  } catch (err) {
    if (err instanceof GatewayError) return { error: err.message };
    throw err;
  }
  revalidatePath("/referrals");
  return { ok: "Code applied. Their account has been credited." };
}

/** Ported from mobile src/screens/shared/ReferralsScreen.tsx. */
export default async function ReferralsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { referral, stats, leaderboard } = await gateway.referrals.mine();

  return (
    <>
      <PageHeader
        title="Referrals"
        description="Invite people to SRN and earn points when they join."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="People referred" value={stats.signupCount} />
        <Stat label="Reward points" value={stats.rewardPoints} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ReferralPanel
          code={referral.code}
          alreadyReferred={referral.referredById !== null}
          applyAction={applyCode}
        />

        <Card>
          <CardHeader
            title="Top referrers"
            description="Who has brought the most people in."
          />
          {leaderboard.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nobody yet"
                description="Be the first to refer someone."
              />
            </div>
          ) : (
            <ol className="divide-y divide-[var(--border)]">
              {leaderboard.map((entry, index) => (
                <li
                  key={entry.userId}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  <span className="w-5 text-sm tabular-nums text-[var(--muted-foreground)]">
                    {index + 1}
                  </span>
                  <Avatar name={entry.name} src={entry.avatarUrl} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {entry.name}
                    {entry.userId === user.id ? " (you)" : ""}
                  </span>
                  <span className="text-sm tabular-nums">
                    {entry.signupCount}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
