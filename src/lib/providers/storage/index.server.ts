import "server-only";

/**
 * Storage implementations and selection.
 *
 * `local` writes under ./public/uploads and serves via a signed route. It is a
 * real implementation — signing, expiry and access checks all work — so the
 * upload path exercised in development is the one that ships. What it is not is
 * durable: like SQLite, it does not survive serverless hosting.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  StorageError,
  type StorageProvider,
  type UploadContext,
  type UploadTarget,
} from "./types";

/** How long an upload target or a signed read URL stays valid. */
const SIGNATURE_TTL_MS = 15 * 60 * 1000;

function signingKey(): string {
  return (
    process.env.STORAGE_SIGNING_SECRET ??
    ((globalThis as { __storageSecret?: string }).__storageSecret ??= randomUUID())
  );
}

export function signStoragePath(storageKey: string, expiresAt: number): string {
  return createHmac("sha256", signingKey())
    .update(`${storageKey}:${expiresAt}`)
    .digest("base64url");
}

/** Constant-time verification, used by both the upload and read routes. */
export function verifyStorageSignature(
  storageKey: string,
  expiresAt: number,
  signature: string,
): boolean {
  if (Date.now() > expiresAt) return false;

  const expected = signStoragePath(storageKey, expiresAt);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Where local objects live. Gitignored — see .gitignore. */
const LOCAL_ROOT = path.join(process.cwd(), "public", "uploads");

/**
 * Guards against a storage key escaping the uploads directory.
 *
 * Keys are generated server-side, but this function is the last line before a
 * filesystem write, so it does not assume that.
 */
function resolveLocalPath(storageKey: string): string {
  const resolved = path.resolve(LOCAL_ROOT, storageKey);
  if (!resolved.startsWith(LOCAL_ROOT + path.sep)) {
    throw new StorageError("Invalid storage key", "storage/bad-key");
  }
  return resolved;
}

class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  readonly isConfigured = true;

  async createUploadTarget(input: {
    storageKey: string;
    mimeType: string;
  }): Promise<UploadTarget> {
    const expiresAt = Date.now() + SIGNATURE_TTL_MS;
    const signature = signStoragePath(input.storageKey, expiresAt);

    return {
      uploadUrl: `/api/v1/storage/upload?key=${encodeURIComponent(input.storageKey)}&expires=${expiresAt}&sig=${signature}`,
      storageKey: input.storageKey,
      headers: { "Content-Type": input.mimeType },
    };
  }

  async getReadUrl(
    storageKey: string,
    context: UploadContext,
  ): Promise<string> {
    // Identity documents and dispute evidence are never public assets.
    if (context === "document" || context === "evidence") {
      const expiresAt = Date.now() + SIGNATURE_TTL_MS;
      const signature = signStoragePath(storageKey, expiresAt);
      return `/api/v1/storage/read?key=${encodeURIComponent(storageKey)}&expires=${expiresAt}&sig=${signature}`;
    }
    return `/uploads/${storageKey}`;
  }

  async delete(storageKey: string): Promise<void> {
    await unlink(resolveLocalPath(storageKey)).catch(() => {
      // Already gone is the desired end state.
    });
  }

  /** Used by the upload route once the signature checks out. */
  async write(storageKey: string, bytes: Buffer): Promise<void> {
    const target = resolveLocalPath(storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

/**
 * Firebase Storage — the intended production backend.
 *
 * NOT wired up yet: it needs a bucket that does not exist, and the mobile app's
 * bucket is deliberately not being reused. The interface and the call sites are
 * final, so connecting it is implementing three methods here plus setting
 * STORAGE_PROVIDER=firebase. Flagged in WEB_MIGRATION_PLAN.md.
 */
class FirebaseStorageProvider implements StorageProvider {
  readonly name = "firebase";

  get isConfigured(): boolean {
    return Boolean(
      process.env.FIREBASE_STORAGE_BUCKET &&
        process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY,
    );
  }

  private notImplemented(): never {
    throw new StorageError(
      "Firebase Storage is not wired up yet. Run with STORAGE_PROVIDER=local, " +
        "or implement FirebaseStorageProvider — the interface is final.",
      "storage/not-implemented",
    );
  }

  async createUploadTarget(): Promise<UploadTarget> {
    this.notImplemented();
  }
  async getReadUrl(): Promise<string> {
    this.notImplemented();
  }
  async delete(): Promise<void> {
    this.notImplemented();
  }
}

export type StorageProviderName = "local" | "firebase";

export function configuredStorageProviderName(): StorageProviderName {
  const configured = process.env.STORAGE_PROVIDER?.toLowerCase();
  return configured === "firebase" ? "firebase" : "local";
}

let cached: StorageProvider | null = null;

export function storageProvider(): StorageProvider {
  cached ??=
    configuredStorageProviderName() === "firebase"
      ? new FirebaseStorageProvider()
      : new LocalStorageProvider();
  return cached;
}

/** The local provider's file writer, for the upload route only. */
export function localStorageWriter(): LocalStorageProvider {
  const provider = storageProvider();
  if (!(provider instanceof LocalStorageProvider)) {
    throw new StorageError(
      "Local upload route called while a different provider is active",
      "storage/wrong-provider",
    );
  }
  return provider;
}

export { StorageError };
export type { StorageProvider, UploadContext, UploadTarget };
