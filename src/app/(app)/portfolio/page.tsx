import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gateway, GatewayError } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import { isProviderRole } from "@/lib/repositories/types";
import { ButtonLink, PageHeader } from "@/components/ui";
import { PortfolioManager } from "./PortfolioManager";

export const metadata = { title: "Portfolio — SRN" };

export type PortfolioState = { error?: string };

async function addItem(
  _prev: PortfolioState,
  formData: FormData,
): Promise<PortfolioState> {
  "use server";
  try {
    await gateway.portfolio.add({
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      projectUrl: String(formData.get("projectUrl") ?? "") || undefined,
      imageUrl: String(formData.get("imageUrl") ?? "") || undefined,
    });
  } catch (err) {
    if (err instanceof GatewayError) return { error: err.message };
    throw err;
  }
  revalidatePath("/portfolio");
  return {};
}

async function deleteItem(formData: FormData): Promise<void> {
  "use server";
  await gateway.portfolio
    .delete({ id: String(formData.get("id") ?? "") })
    .catch(() => {});
  revalidatePath("/portfolio");
}

async function toggleFeatured(formData: FormData): Promise<void> {
  "use server";
  await gateway.portfolio
    .setFeatured({
      id: String(formData.get("id") ?? ""),
      featured: formData.get("featured") === "true",
    })
    .catch(() => {});
  revalidatePath("/portfolio");
}

/** Ported from mobile src/screens/digital/PortfolioScreen.tsx. */
export default async function PortfolioPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isProviderRole(user.role)) redirect("/dashboard");

  const page = await gateway.portfolio.listMine();

  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Work you've done. Featured items appear first on your public profile."
        action={
          <ButtonLink variant="outline" href={`/providers/${user.id}`}>
            View public profile
          </ButtonLink>
        }
      />
      <PortfolioManager
        items={page.items}
        addAction={addItem}
        deleteAction={deleteItem}
        featureAction={toggleFeatured}
      />
    </>
  );
}
