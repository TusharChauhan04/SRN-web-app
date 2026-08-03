/**
 * Signed read for private objects — KYC documents and dispute evidence.
 *
 * These are identity documents. The upload root sits outside the web root, so
 * this route is the ONLY way to reach them; the signature is short-lived and minted only by
 * `storageProvider().getReadUrl()`, which the services call for the specific
 * user allowed to see them.
 */
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import {
  configuredStorageProviderName,
  resolveLocalPath,
  verifyStorageSignature,
} from "@/lib/providers/storage/index.server";

export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

export async function GET(req: Request) {
  if (configuredStorageProviderName() !== "local") {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const expires = Number(url.searchParams.get("expires"));
  const sig = url.searchParams.get("sig");

  if (!key || !sig || !Number.isFinite(expires)) {
    return NextResponse.json({ error: { message: "Bad request" } }, { status: 400 });
  }
  // "get" — see the matching note in the upload route.
  if (!verifyStorageSignature(key, expires, sig, "get")) {
    return NextResponse.json(
      { error: { message: "This link is invalid or has expired" } },
      { status: 403 },
    );
  }

  let bytes: Buffer;
  try {
    // resolveLocalPath is the traversal guard, shared with the writer so the
    // two can never disagree about where the root is.
    bytes = await readFile(resolveLocalPath(key));
  } catch {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const extension = key.split(".").pop()?.toLowerCase() ?? "";

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      // Never cached by a shared cache — the URL is short-lived by design.
      "Cache-Control": "private, no-store",
      // Force download rather than inline render, so an uploaded file can't be
      // interpreted as a document in our origin.
      "Content-Disposition": "attachment",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
