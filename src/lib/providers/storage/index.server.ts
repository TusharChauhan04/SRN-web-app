import "server-only";

/**
 * Storage implementations and selection.
 *
 * `local` writes under ./.data/uploads — NOT ./public/uploads, which would put
 * every identity document on an unauthenticated URL; see LOCAL_ROOT below. It
 * is a real implementation: signing, expiry and access checks all work, so the
 * upload path exercised in development is the one that ships. What it is not is
 * durable — like SQLite, it does not survive serverless hosting.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  StorageError,
  type StorageProvider,
  type UploadContext,
  type UploadTarget,
} from "./types";

/** How long an upload target or a signed read URL stays valid. */
const SIGNATURE_TTL_MS = 15 * 60 * 1000;

/**
 * What a signature authorises. Signatures are NOT interchangeable.
 *
 * They used to be: both routes verified the same `key:expires` HMAC, so a read
 * URL minted for an admin reviewing a KYC document doubled as a WRITE
 * capability to that same key for the rest of its TTL. If that link leaked, the
 * applicant identity document could be overwritten. Mixing the operation into
 * the HMAC input makes a read token useless for writing.
 */
export type StorageOperation = "put" | "get";

function signingKey(): string {
  const configured = process.env.STORAGE_SIGNING_SECRET;
  if (configured) return configured;

  /*
   * No secret configured. A random per-process key is fine for a single dev
   * server and WRONG anywhere with more than one instance: each would sign with
   * a different key, so a URL minted by one 403s on another — intermittently,
   * and only on the identity-document screen. Preflight makes this fatal in
   * production; this is the last word on it.
   */
  if (process.env.NODE_ENV === "production") {
    throw new StorageError(
      "STORAGE_SIGNING_SECRET must be set in production. Without it every " +
        "instance signs with a different key and signed URLs fail at random.",
      "storage/no-signing-secret",
    );
  }
  return ((globalThis as { __storageSecret?: string }).__storageSecret ??=
    randomUUID());
}

export function signStoragePath(
  storageKey: string,
  expiresAt: number,
  operation: StorageOperation,
): string {
  return createHmac("sha256", signingKey())
    .update(`${operation}:${storageKey}:${expiresAt}`)
    .digest("base64url");
}

/** Constant-time verification, used by both the upload and read routes. */
export function verifyStorageSignature(
  storageKey: string,
  expiresAt: number,
  signature: string,
  operation: StorageOperation,
): boolean {
  if (Date.now() > expiresAt) return false;

  const expected = signStoragePath(storageKey, expiresAt, operation);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Where local objects live. Gitignored — see .gitignore.
 *
 * DELIBERATELY NOT under `public/`. Next.js serves everything in `public/`
 * unauthenticated at the root path, so a KYC document written to
 * `public/uploads/document/<uid>/<uuid>.pdf` was simultaneously reachable at
 * `/uploads/document/<uid>/<uuid>.pdf` — no signature, no expiry, no auth, and
 * cacheable. Every protection the signed read route applies was bypassable by
 * anyone who learned the key, and keys travel: admin browser history, Referer
 * headers, proxy logs, and the GDPR export bundle, which returns Upload rows
 * verbatim.
 *
 * Everything is served through a route now, so this directory must stay outside
 * the web root. Moving it back reopens that hole silently.
 */
export const LOCAL_ROOT = path.join(process.cwd(), ".data", "uploads");

/**
 * Guards against a storage key escaping the uploads directory.
 *
 * Keys are generated server-side, but this function is the last line before a
 * filesystem write, so it does not assume that.
 */
export function resolveLocalPath(storageKey: string): string {
  const resolved = path.resolve(LOCAL_ROOT, storageKey);
  if (!resolved.startsWith(LOCAL_ROOT + path.sep)) {
    throw new StorageError("Invalid storage key", "storage/bad-key");
  }
  return resolved;
}

class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  readonly isConfigured = true;

  constructor() {
    /*
     * Refuse to exist in production, exactly as MockAuthServerProvider,
     * MockPaymentProvider and ConsoleOtpProvider do.
     *
     * Local disk does not survive serverless hosting, so files would vanish
     * between deploys — and unlike a mock payment, that failure is silent until
     * someone asks for a document that is already gone.
     */
    if (process.env.NODE_ENV === "production") {
      throw new StorageError(
        "Local disk storage cannot be used in production — uploads would not " +
          "survive a deploy. Set STORAGE_PROVIDER=firebase and configure a bucket.",
        "storage/not-production-safe",
      );
    }
  }

  async createUploadTarget(input: {
    storageKey: string;
    mimeType: string;
  }): Promise<UploadTarget> {
    const expiresAt = Date.now() + SIGNATURE_TTL_MS;
    const signature = signStoragePath(input.storageKey, expiresAt, "put");

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
      const signature = signStoragePath(storageKey, expiresAt, "get");
      return `/api/v1/storage/read?key=${encodeURIComponent(storageKey)}&expires=${expiresAt}&sig=${signature}`;
    }
    /*
     * Avatars and portfolio images are public by design — no signature, no
     * expiry, cacheable. But they can no longer come from `/uploads/...`,
     * because that directory is out of the web root (see LOCAL_ROOT). This
     * route serves the same bytes with the same accessibility, and refuses any
     * key outside the public contexts.
     */
    return `/api/v1/storage/public?key=${encodeURIComponent(storageKey)}`;
  }

  async exists(storageKey: string): Promise<boolean> {
    return access(resolveLocalPath(storageKey)).then(
      () => true,
      () => false,
    );
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await unlink(resolveLocalPath(storageKey));
    } catch (err) {
      /*
       * ENOENT only. Already gone IS the desired end state — but nothing else
       * is.
       *
       * This used to be `.catch(() => {})`, which swallowed EPERM, EACCES,
       * EBUSY and EISDIR as success. That made the erasure guard in
       * `eraseUserData` unreachable: it aborts before anonymize when a delete
       * rejects, and no delete could ever reject. Erasure reported success,
       * then destroyed the Upload rows — leaving identity documents on disk
       * with nothing left pointing at them.
       */
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
    }
  }

  /** Used by the upload route once the signature checks out. */
  async write(storageKey: string, bytes: Buffer): Promise<void> {
    const target = resolveLocalPath(storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    // "wx" — fail if it already exists. The route checks first for a clean 409,
    // but check-then-write is not atomic; this makes write-once actually true.
    await writeFile(target, bytes, { flag: "wx" });
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
  async exists(): Promise<boolean> {
    this.notImplemented();
  }
  async delete(): Promise<void> {
    this.notImplemented();
  }
}

/**
 * Supabase Storage — the production backend.
 *
 * Implemented against the REST API with `fetch` rather than @supabase/supabase-js.
 * The whole surface is four calls; the SDK would add a dependency, a client
 * lifecycle and a second auth model to reason about, for HTTP requests that fit
 * on a page. It also keeps the eventual move off Supabase to editing one file.
 *
 * SERVICE ROLE KEY. Every call here authenticates with it, which bypasses row
 * level security entirely — that is why this file is `server-only` and why the
 * key must never reach the browser. The client never talks to Supabase: it PUTs
 * to a short-lived signed URL this provider mints, exactly as the local
 * provider hands out a signed route URL.
 */
class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase";

  get isConfigured(): boolean {
    return Boolean(
      process.env.SUPABASE_URL &&
        process.env.SUPABASE_SERVICE_ROLE_KEY &&
        process.env.SUPABASE_STORAGE_BUCKET,
    );
  }

  private config(): { url: string; key: string; bucket: string } {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET;

    if (!url || !key || !bucket) {
      throw new StorageError(
        "Supabase Storage is not configured. Set SUPABASE_URL, " +
          "SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET.",
        "storage/not-configured",
      );
    }
    return { url: url.replace(/\/+$/, ""), key, bucket };
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const { url, key } = this.config();
    return fetch(`${url}/storage/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // Never serve a stale answer for an existence check or a signed URL.
      cache: "no-store",
    });
  }

  /**
   * A signed upload URL the client PUTs to directly.
   *
   * Preserves the three-step contract in types.ts: the bytes never pass through
   * our server, so a large file does not occupy a request handler.
   */
  async createUploadTarget(input: {
    storageKey: string;
    mimeType: string;
    context: UploadContext;
  }): Promise<UploadTarget> {
    const { url, bucket } = this.config();
    const res = await this.call(
      "POST",
      `object/upload/sign/${bucket}/${input.storageKey}`,
    );

    if (!res.ok) {
      throw new StorageError(
        `Could not create an upload target (${res.status}).`,
        "storage/upload-target-failed",
      );
    }

    const { url: signedPath } = (await res.json()) as { url: string };
    return {
      // The response is a path; the client needs an absolute URL.
      uploadUrl: `${url}/storage/v1${signedPath.startsWith("/") ? "" : "/"}${signedPath}`,
      storageKey: input.storageKey,
      headers: { "Content-Type": input.mimeType },
    };
  }

  /**
   * `document` and `evidence` MUST be signed and short-lived — they are KYC
   * identity documents and dispute evidence. Only avatars and portfolio images
   * get a stable public URL, and only because they are public by design.
   *
   * If the bucket is private (it should be), the public branch still requires
   * the bucket's public flag to be on. Getting that wrong fails visibly — a
   * broken avatar — rather than silently exposing a document, because the
   * document branch never takes the public path regardless of bucket settings.
   */
  async getReadUrl(
    storageKey: string,
    context: UploadContext,
  ): Promise<string> {
    const { url, bucket } = this.config();

    if (context === "document" || context === "evidence") {
      const res = await this.call("POST", `object/sign/${bucket}/${storageKey}`, {
        expiresIn: Math.floor(SIGNATURE_TTL_MS / 1000),
      });
      if (!res.ok) {
        throw new StorageError(
          `Could not sign a read URL (${res.status}).`,
          "storage/sign-failed",
        );
      }
      const { signedURL } = (await res.json()) as { signedURL: string };
      return `${url}/storage/v1${signedURL.startsWith("/") ? "" : "/"}${signedURL}`;
    }

    return `${url}/storage/v1/object/public/${bucket}/${storageKey}`;
  }

  async exists(storageKey: string): Promise<boolean> {
    const { bucket } = this.config();
    const res = await this.call("HEAD", `object/${bucket}/${storageKey}`);
    if (res.ok) return true;

    /*
     * A missing object answers 400 here, not 404 — verified against the API.
     * So "not ok" cannot simply mean "absent": 401/403 mean the credentials are
     * wrong, and reporting that as "absent" would make `uploads.confirm` reject
     * a file the user really did upload, blaming them for our misconfiguration.
     */
    if (res.status === 401 || res.status === 403) {
      throw new StorageError(
        `Storage rejected our credentials (${res.status}). Check ` +
          "SUPABASE_SERVICE_ROLE_KEY — the anon key will not work here.",
        "storage/unauthorised",
      );
    }
    return false;
  }

  async delete(storageKey: string): Promise<void> {
    const { bucket } = this.config();
    const res = await this.call("DELETE", `object/${bucket}/${storageKey}`);
    if (res.ok) return;

    /*
     * Deleting something already gone IS the desired end state. Nothing else is.
     *
     * The status code cannot decide this. Supabase answers a missing object with
     * HTTP 400 and puts the real outcome in the BODY:
     *
     *   {"statusCode":"404","error":"not_found","code":"NoSuchKey"}
     *
     * so treating 400 as success would swallow every genuine failure, and
     * treating it as failure breaks idempotent deletion. The body is parsed
     * instead. This is precisely the mistake the local provider made in the
     * other direction: a blanket `.catch(() => {})` swallowed permission errors
     * as success, which made the erasure guard in eraseUserData unreachable —
     * it aborts before anonymising when a delete rejects, and no delete could
     * ever reject. Erasure reported success and then destroyed the Upload rows,
     * leaving identity documents in storage with nothing pointing at them.
     *
     * KNOWN LIMIT, measured not assumed: a nonexistent BUCKET returns the same
     * NoSuchKey body, so this cannot tell "object absent" from "bucket wrong".
     * Accepted because a wrong bucket fails loudly on upload and on every read
     * long before any delete runs — it is not a state that reaches here quietly.
     */
    let notFound = false;
    try {
      const body = (await res.json()) as { code?: string; statusCode?: string };
      notFound = body.code === "NoSuchKey" || body.statusCode === "404";
    } catch {
      // Unparseable body — treat as a real failure, below.
    }
    if (notFound) return;

    throw new StorageError(
      `Could not delete ${storageKey} (${res.status}).`,
      "storage/delete-failed",
    );
  }
}

export type StorageProviderName = "local" | "firebase" | "supabase";

export function configuredStorageProviderName(): StorageProviderName {
  const configured = process.env.STORAGE_PROVIDER?.toLowerCase();
  if (configured === "supabase") return "supabase";
  if (configured === "firebase") return "firebase";
  if (configured === "local") return "local";

  /*
   * Unrecognised or unset. Fail CLOSED in production.
   *
   * This used to return "local" for anything it did not recognise, which meant
   * a typo (`firebse`, `gcs`, a leftover placeholder) silently selected local
   * disk in production — and preflight, which compared the raw env string to
   * "local", reported the configuration deployable. Auth, payments and OTP all
   * fall back to their PRODUCTION implementation on an unknown value and fail
   * loudly; storage was the one that fell back to the insecure option. Now it
   * matches: unknown means a production provider, which then complains about
   * its missing configuration instead of quietly writing identity documents to
   * disk.
   *
   * The production default is SUPABASE, because that is the chosen vendor —
   * Firebase Storage stays selectable but is still an unimplemented stub, so
   * defaulting to it would fail closed into a dead end rather than a working
   * one.
   */
  return process.env.NODE_ENV === "production" ? "supabase" : "local";
}

let cached: StorageProvider | null = null;

export function storageProvider(): StorageProvider {
  if (cached) return cached;

  switch (configuredStorageProviderName()) {
    case "supabase":
      cached = new SupabaseStorageProvider();
      break;
    case "firebase":
      cached = new FirebaseStorageProvider();
      break;
    default:
      cached = new LocalStorageProvider();
  }
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
