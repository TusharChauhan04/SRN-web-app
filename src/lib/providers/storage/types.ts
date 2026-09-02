/**
 * File storage abstraction.
 *
 * Mobile uploaded via presigned URLs to the old backend's Firebase Storage
 * bucket. We are not reusing that bucket, so this is a fresh decision — and it
 * gets the same treatment as auth and payments: an interface, a working local
 * implementation, and a vendor implementation behind a config switch.
 *
 * The three-step contract is preserved from mobile (`src/lib/uploadService.ts`)
 * because it is the right shape regardless of vendor:
 *
 *   1. `createUpload`  — server validates type/size and records intent
 *   2. client PUTs the bytes to the returned URL
 *   3. `confirmUpload` — server marks it usable
 *
 * Step 2 never touches our server, so a large file doesn't occupy a request
 * handler, and an abandoned upload leaves an unconfirmed row rather than a
 * mystery object.
 */

export type UploadContext =
  | "avatar"
  | "portfolio"
  | "document"
  | "evidence"
  | "chat";

/**
 * What each context is allowed to contain.
 *
 * KYC documents ("document") accept PDFs because identity documents are often
 * scanned as one. Everything else is images only — accepting arbitrary types on
 * a public avatar is how you end up serving HTML from your own origin.
 */
export const UPLOAD_RULES: Record<
  UploadContext,
  { maxBytes: number; mimeTypes: readonly string[] }
> = {
  avatar: {
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
  },
  portfolio: {
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
  },
  document: {
    maxBytes: 15 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "application/pdf"],
  },
  evidence: {
    maxBytes: 15 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "application/pdf"],
  },
  /*
   * Files sent inside a conversation.
   *
   * Deliberately NOT in the provider's PUBLIC_CONTEXTS, so it resolves to the
   * private bucket and is served as an expiring signed URL — the same treatment
   * as identity documents. Chat content is between two people and must not be
   * guessable from a public bucket path.
   *
   * Smaller than `document` because this is an attachment to a message, not a
   * submitted record, and every recipient pays the download.
   */
  chat: {
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ],
  },
};

export interface UploadTarget {
  /** Where the client PUTs the bytes. */
  uploadUrl: string;
  /** Opaque key we store; resolving it to a URL is the provider's job. */
  storageKey: string;
  /** Extra headers the client must send with the PUT. */
  headers: Record<string, string>;
}

export interface StorageProvider {
  readonly name: string;
  readonly isConfigured: boolean;

  /** Issues a short-lived upload target for a validated file. */
  createUploadTarget(input: {
    storageKey: string;
    mimeType: string;
    context: UploadContext;
  }): Promise<UploadTarget>;

  /**
   * A URL for reading the object.
   *
   * `document` and `evidence` MUST return a short-lived signed URL — these are
   * identity documents and dispute evidence, not public assets. `avatar` and
   * `portfolio` may return a stable public URL.
   */
  getReadUrl(storageKey: string, context: UploadContext): Promise<string>;

  /**
   * Whether an object was actually written.
   *
   * `uploads.confirm` used to take the client's word for it: the browser could
   * call prepare then confirm and never PUT a single byte, leaving a "confirmed"
   * row pointing at nothing — a KYC submission an admin opens to find an empty
   * document, or an avatar URL that 404s on every page that renders it.
   */
  exists(storageKey: string): Promise<boolean>;

  delete(storageKey: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/** Rejects anything outside the rules for its context. */
export function validateUpload(
  context: UploadContext,
  mimeType: string,
  sizeBytes: number,
): void {
  const rules = UPLOAD_RULES[context];

  if (!rules.mimeTypes.includes(mimeType)) {
    throw new StorageError(
      `That file type isn't allowed here. Accepted: ${rules.mimeTypes.join(", ")}.`,
      "storage/bad-type",
    );
  }
  if (sizeBytes <= 0 || sizeBytes > rules.maxBytes) {
    throw new StorageError(
      `Files must be under ${Math.round(rules.maxBytes / 1024 / 1024)}MB.`,
      "storage/too-large",
    );
  }
}
