import "server-only";

/**
 * Provider tooling: portfolio, availability, earnings, analytics, uploads.
 */
import { randomUUID } from "node:crypto";
import { repo } from "@/lib/repositories";
import {
  isProviderRole,
  type BlockedDate,
  type PortfolioItem,
  type Upload,
  type User,
  type WorkingHours,
} from "@/lib/repositories/types";
import type { ProviderAnalytics } from "@/lib/repositories/interfaces";
import {
  StorageError,
  storageProvider,
  type UploadContext,
} from "@/lib/providers/storage/index.server";
import { validateUpload } from "@/lib/providers/storage/types";
import { GatewayError } from "@/lib/gateway/types";

function assertProvider(actor: User): void {
  if (!isProviderRole(actor.role)) {
    throw GatewayError.forbidden("This is only available to providers.");
  }
}

// ─────────────────────────── Portfolio ───────────────────────────

export async function listMyPortfolio(actor: User) {
  return repo.portfolio.listByUser(actor.id, { limit: 60 });
}

export async function addPortfolioItem(
  actor: User,
  input: {
    title: string;
    description?: string;
    imageUrl?: string;
    projectUrl?: string;
  },
): Promise<PortfolioItem> {
  assertProvider(actor);
  return repo.portfolio.create({ userId: actor.id, ...input });
}

/** Ownership is checked here — the repository takes an id and trusts it. */
async function assertOwnsPortfolioItem(
  actor: User,
  itemId: string,
): Promise<PortfolioItem> {
  const item = await repo.portfolio.findById(itemId);
  if (!item) throw GatewayError.notFound("Portfolio item not found");
  if (item.userId !== actor.id) {
    throw GatewayError.notFound("Portfolio item not found");
  }
  return item;
}

export async function updatePortfolioItem(
  actor: User,
  itemId: string,
  input: { title?: string; description?: string; projectUrl?: string },
): Promise<PortfolioItem> {
  await assertOwnsPortfolioItem(actor, itemId);
  return repo.portfolio.update(itemId, input);
}

export async function setPortfolioFeatured(
  actor: User,
  itemId: string,
  featured: boolean,
): Promise<PortfolioItem> {
  await assertOwnsPortfolioItem(actor, itemId);
  return repo.portfolio.setFeatured(itemId, featured);
}

export async function deletePortfolioItem(
  actor: User,
  itemId: string,
): Promise<void> {
  await assertOwnsPortfolioItem(actor, itemId);
  await repo.portfolio.delete(itemId);
}

// ─────────────────────────── Availability ───────────────────────────

export interface AvailabilityView {
  workingHours: WorkingHours[];
  blockedDates: BlockedDate[];
}

export async function getMyAvailability(
  actor: User,
): Promise<AvailabilityView> {
  const [workingHours, blockedDates] = await Promise.all([
    repo.availability.getWorkingHours(actor.id),
    repo.availability.listBlockedDates(actor.id),
  ]);
  return { workingHours, blockedDates };
}

export async function setMyWorkingHours(
  actor: User,
  hours: { dayOfWeek: number; startTime: string; endTime: string; isEnabled: boolean }[],
): Promise<WorkingHours[]> {
  assertProvider(actor);

  for (const h of hours) {
    if (h.isEnabled && h.endTime <= h.startTime) {
      throw GatewayError.validation(
        "A day's end time must be after its start time.",
      );
    }
  }

  return repo.availability.setWorkingHours(actor.id, hours);
}

export async function blockDate(
  actor: User,
  date: Date,
  reason?: string,
): Promise<void> {
  assertProvider(actor);
  await repo.availability.blockDate(actor.id, date, reason);
}

export async function unblockDate(actor: User, date: Date): Promise<void> {
  await repo.availability.unblockDate(actor.id, date);
}

// ─────────────────────────── Earnings & analytics ───────────────────────────

export interface EarningsView {
  totalEarned: number;
  pendingAmount: number;
  completedCount: number;
  recent: {
    id: string;
    amount: number;
    title: string;
    customerName: string;
    completedAt: Date | null;
  }[];
}

export async function getMyEarnings(actor: User): Promise<EarningsView> {
  assertProvider(actor);

  const [totalEarned, completed, active] = await Promise.all([
    repo.bookings.sumCompletedAmount(actor.id),
    repo.bookings.list({ providerId: actor.id, status: "completed", limit: 20 }),
    repo.bookings.list({ providerId: actor.id, status: "in_progress", limit: 50 }),
  ]);

  // "Pending" is work committed but not yet paid out — in-progress bookings.
  const pendingAmount = active.items.reduce((sum, b) => sum + b.amount, 0);

  return {
    totalEarned,
    pendingAmount,
    completedCount: completed.total ?? completed.items.length,
    recent: completed.items.map((b) => ({
      id: b.id,
      amount: b.amount,
      title: b.requirement?.title ?? "Direct booking",
      customerName: b.customer?.name ?? "Customer",
      completedAt: b.completedAt ?? null,
    })),
  };
}

export async function getMyAnalytics(
  actor: User,
  days = 30,
): Promise<ProviderAnalytics> {
  assertProvider(actor);
  return repo.analytics.providerAnalytics(actor.id, days);
}

// ─────────────────────────── Uploads ───────────────────────────

export interface PreparedUpload {
  uploadId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

/**
 * Validates a file and issues an upload target.
 *
 * Type and size are checked HERE, server-side, before any URL is handed out —
 * a client-side accept attribute is a hint, not a control.
 */
export async function prepareUpload(
  actor: User,
  input: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    context: UploadContext;
    entityId?: string;
  },
): Promise<PreparedUpload> {
  try {
    validateUpload(input.context, input.mimeType, input.sizeBytes);
  } catch (err) {
    if (err instanceof StorageError) throw GatewayError.validation(err.message);
    throw err;
  }

  // Key is generated server-side and namespaced by user, so one account can
  // never write into another's prefix and the original filename never becomes
  // a path.
  const extension = input.fileName.split(".").pop()?.toLowerCase() ?? "bin";
  const safeExtension = /^[a-z0-9]{1,5}$/.test(extension) ? extension : "bin";
  const storageKey = `${input.context}/${actor.id}/${randomUUID()}.${safeExtension}`;

  const target = await storageProvider().createUploadTarget({
    storageKey,
    mimeType: input.mimeType,
    context: input.context,
  });

  const upload = await repo.uploads.create({
    userId: actor.id,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    context: input.context,
    entityId: input.entityId,
    storageKey: target.storageKey,
  });

  return {
    uploadId: upload.id,
    uploadUrl: target.uploadUrl,
    headers: target.headers,
  };
}

/** Marks an upload usable and returns its readable URL. */
export async function confirmUpload(
  actor: User,
  uploadId: string,
): Promise<Upload> {
  const upload = await repo.uploads.findById(uploadId);
  if (!upload) throw GatewayError.notFound("Upload not found");
  if (upload.userId !== actor.id) {
    throw GatewayError.notFound("Upload not found");
  }

  const url = await storageProvider().getReadUrl(
    upload.storageKey,
    upload.context,
  );
  const confirmed = await repo.uploads.confirm(uploadId, url);

  // An avatar is the one upload that immediately changes the profile.
  if (upload.context === "avatar") {
    await repo.users.update(actor.id, { avatarUrl: url });
  }

  return confirmed;
}
