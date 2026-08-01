"use server";

/**
 * Admin mutations.
 *
 * All go through the gateway, which enforces `access: "admin"` before the
 * handler runs and audits the sensitive ones in the service layer.
 */
import { revalidatePath } from "next/cache";
import { gateway, GatewayError } from "@/lib/gateway";
import type { UserRole } from "@/lib/repositories/types";

export type AdminState = { error?: string; ok?: string };

async function run(fn: () => Promise<unknown>): Promise<AdminState> {
  try {
    await fn();
    return {};
  } catch (err) {
    if (err instanceof GatewayError) return { error: err.message };
    throw err;
  }
}

export async function setSuspended(formData: FormData): Promise<void> {
  await run(() =>
    gateway.admin.setSuspended({
      userId: String(formData.get("userId") ?? ""),
      suspended: formData.get("suspended") === "true",
    }),
  );
  revalidatePath("/admin/users");
}

export async function setRole(formData: FormData): Promise<void> {
  await run(() =>
    gateway.admin.setRole({
      userId: String(formData.get("userId") ?? ""),
      role: String(formData.get("role") ?? "") as UserRole,
    }),
  );
  revalidatePath("/admin/users");
}

/**
 * Irreversible. Requires the operator to type ERASE, which the gateway
 * validates as a literal — a stray click or a replayed request can't trigger it.
 */
export async function eraseUser(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const confirm = String(formData.get("confirm") ?? "");
  if (confirm !== "ERASE") {
    return { error: 'Type ERASE exactly to confirm.' };
  }

  const result = await run(() =>
    gateway.admin.eraseUser({
      userId: String(formData.get("userId") ?? ""),
      confirm: "ERASE",
    }),
  );
  if (result.error) return result;

  revalidatePath("/admin/users");
  return { ok: "Account erased. Personal data and stored files were removed." };
}

export async function resolveDispute(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const result = await run(() =>
    gateway.admin.resolveDispute({
      disputeId: String(formData.get("disputeId") ?? ""),
      resolution: String(formData.get("resolution") ?? ""),
      outcome: String(formData.get("outcome") ?? "resolved") as
        | "resolved"
        | "rejected",
    }),
  );
  if (result.error) return result;

  revalidatePath("/admin/disputes");
  return { ok: "Dispute closed and both parties notified." };
}

export async function approveVerification(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const result = await run(() =>
    gateway.admin.approveVerification({
      requestId: String(formData.get("requestId") ?? ""),
      note: String(formData.get("note") ?? "") || undefined,
    }),
  );
  if (result.error) return result;

  revalidatePath("/admin/verification");
  return { ok: "Approved. The user is now verified." };
}

export async function rejectVerification(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const result = await run(() =>
    gateway.admin.rejectVerification({
      requestId: String(formData.get("requestId") ?? ""),
      note: String(formData.get("note") ?? ""),
    }),
  );
  if (result.error) return result;

  revalidatePath("/admin/verification");
  return { ok: "Rejected. The user has been told why." };
}

export async function clearMessageFlag(formData: FormData): Promise<void> {
  await run(() =>
    gateway.admin.clearMessageFlag({
      messageId: String(formData.get("messageId") ?? ""),
    }),
  );
  revalidatePath("/admin/moderation");
}

export async function resolveReport(formData: FormData): Promise<void> {
  await run(() =>
    gateway.admin.resolveReport({
      reportId: String(formData.get("reportId") ?? ""),
    }),
  );
  revalidatePath("/admin/moderation");
}

export async function setFlag(formData: FormData): Promise<void> {
  await run(() =>
    gateway.admin.setFlag({
      key: String(formData.get("key") ?? ""),
      enabled: formData.get("enabled") === "true",
    }),
  );
  revalidatePath("/admin/flags");
}
