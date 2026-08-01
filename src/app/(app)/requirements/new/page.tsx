import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { isSeekerRole } from "@/lib/repositories/types";
import { PageHeader } from "@/components/ui";
import { NewRequirementForm } from "./NewRequirementForm";

export const metadata = { title: "Post a requirement — SRN" };

/** Ported from mobile src/screens/shared/PostRequirementScreen.tsx. */
export default async function NewRequirementPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Providers bid on work rather than posting it, matching mobile where this
  // tab only exists for business and customer. The gateway rejects it too;
  // this just avoids showing a form that would always fail.
  if (!isSeekerRole(user.role)) redirect("/requirements");

  return (
    <>
      <PageHeader
        title="Post a requirement"
        description="Describe what you need. Providers matched to your skills will bid on it."
      />
      <NewRequirementForm />
    </>
  );
}
