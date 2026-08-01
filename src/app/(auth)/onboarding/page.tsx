import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { homeForRole } from "@/lib/nav/config";
import { OnboardingForm } from "./OnboardingForm";

export const metadata = { title: "Set up your account — SRN" };

/** Ported from mobile src/screens/auth/OnboardingScreen.tsx. */
export default async function OnboardingPage() {
  const session = await getSession();

  if (!session) redirect("/login");
  if (session.user) redirect(homeForRole(session.user.role));

  return <OnboardingForm email={session.email ?? ""} />;
}
