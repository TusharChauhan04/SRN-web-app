import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { homeForRole } from "@/lib/nav/config";

/**
 * Entry point. Routes by session state, mirroring the three-way branch in
 * mobile's AppNavigator: signed out → login, signed in without a profile →
 * onboarding, signed in with a role → that role's home.
 */
export default async function RootPage() {
  const session = await getSession();

  if (!session) redirect("/login");
  if (!session.user) redirect("/onboarding");

  redirect(homeForRole(session.user.role));
}
