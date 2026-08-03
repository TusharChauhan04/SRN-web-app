/**
 * Local storage upload sink.
 *
 * Only reachable when STORAGE_PROVIDER=local. The signed query string is the
 * authorisation — it is minted server-side by `prepareUpload` after the file's
 * type and size have already been validated, and it expires.
 *
 * A real object store replaces this route entirely with its own presigned PUT;
 * nothing else changes, because callers only ever see `uploadUrl`.
 */
import { NextResponse } from "next/server";
import { access } from "node:fs/promises";
import { UPLOAD_RULES, type UploadContext } from "@/lib/providers/storage/types";
import {
  configuredStorageProviderName,
  localStorageWriter,
  resolveLocalPath,
  verifyStorageSignature,
} from "@/lib/providers/storage/index.server";

export const dynamic = "force-dynamic";

function reject(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function PUT(req: Request) {
  if (configuredStorageProviderName() !== "local") {
    return reject("Not found", 404);
  }

  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const expires = Number(url.searchParams.get("expires"));
  const sig = url.searchParams.get("sig");

  if (!key || !sig || !Number.isFinite(expires)) {
    return reject("Missing upload parameters", 400);
  }
  // "put" — a READ signature must not authorise a write. An admin's KYC review
  // link would otherwise double as permission to overwrite that document.
  if (!verifyStorageSignature(key, expires, sig, "put")) {
    // Covers both a forged signature and an expired one.
    return reject("This upload link is invalid or has expired", 403);
  }

  /*
   * Write ONCE per key.
   *
   * The signature stays valid for 15 minutes, and `submitKyc` stores the KEY,
   * not the bytes — the admin reviewer fetches whatever is at that key at
   * review time. Without this check an applicant could upload a clean document,
   * submit it, then re-PUT a different file to the same URL and be approved
   * against a document nobody ever reviewed (or destroy the evidence behind a
   * rejection). Keys carry a uuid, so a legitimate re-upload is a new key.
   */
  const alreadyWritten = await access(resolveLocalPath(key)).then(
    () => true,
    () => false,
  );
  if (alreadyWritten) {
    return reject("This upload link has already been used", 409);
  }

  // The key's first segment is the context, set server-side when signing.
  const context = key.split("/")[0] as UploadContext;
  const rules = UPLOAD_RULES[context];
  if (!rules) return reject("Unknown upload context", 400);

  const bytes = Buffer.from(await req.arrayBuffer());

  // Re-check the real byte length. The size checked at prepare time was
  // client-declared; this is the actual file.
  if (bytes.byteLength === 0 || bytes.byteLength > rules.maxBytes) {
    return reject(
      `Files must be under ${Math.round(rules.maxBytes / 1024 / 1024)}MB`,
      413,
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!rules.mimeTypes.includes(contentType)) {
    return reject("That file type isn't allowed here", 415);
  }

  await localStorageWriter().write(key, bytes);

  return NextResponse.json({ ok: true });
}
