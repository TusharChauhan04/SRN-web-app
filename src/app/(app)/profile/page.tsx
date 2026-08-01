import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gateway, GatewayError } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import { isProviderRole } from "@/lib/repositories/types";
import { ButtonLink, PageHeader } from "@/components/ui";
import { ProfileForm } from "./ProfileForm";

export const metadata = { title: "Your profile — SRN" };

export type ProfileState = { error?: string; saved?: boolean };

async function saveProfile(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  "use server";

  const skills = String(formData.get("skills") ?? "").trim();
  const hourlyRate = String(formData.get("hourlyRate") ?? "").trim();
  const serviceRadiusKm = String(formData.get("serviceRadiusKm") ?? "").trim();

  try {
    await gateway.profile.update({
      name: String(formData.get("name") ?? ""),
      bio: String(formData.get("bio") ?? ""),
      location: String(formData.get("location") ?? ""),
      title: String(formData.get("title") ?? ""),
      companyName: String(formData.get("companyName") ?? ""),
      industry: String(formData.get("industry") ?? ""),
      skills: skills
        ? skills.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
      hourlyRate: hourlyRate ? Number(hourlyRate) : undefined,
      serviceRadiusKm: serviceRadiusKm ? Number(serviceRadiusKm) : undefined,
      isAvailable: formData.get("isAvailable") === "on",
    });
  } catch (err) {
    if (err instanceof GatewayError) return { error: err.message };
    throw err;
  }

  revalidatePath("/profile");
  return { saved: true };
}

/** Ported from mobile src/screens/shared/ProfileScreen.tsx. */
export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <>
      <PageHeader
        title="Your profile"
        description="This is what customers and providers see."
        action={
          isProviderRole(user.role) ? (
            <ButtonLink variant="outline" href={`/providers/${user.id}`}>
              View public profile
            </ButtonLink>
          ) : null
        }
      />
      <ProfileForm user={user} action={saveProfile} />
    </>
  );
}
