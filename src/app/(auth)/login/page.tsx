import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { homeForRole } from "@/lib/nav/config";
import { AuthProvider } from "@/lib/auth/AuthContext";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in — SRN" };

/** Ported from mobile src/screens/auth/LoginScreen.tsx. */
export default async function LoginPage() {
  const session = await getSession();

  // Already signed in — don't show a sign-in form.
  if (session?.user) redirect(homeForRole(session.user.role));
  if (session) redirect("/onboarding");

  return (
    <AuthProvider initialUser={null}>
      <LoginForm />
    </AuthProvider>
  );
}
