/**
 * Signed read for private objects — KYC documents and dispute evidence.
 *
 * These are identity documents. They are never served from the public
 * /uploads path; the signature is short-lived and minted only by
 * `storageProvider().getReadUrl()`, which the services call for the specific
 * user allowed to see them.
 */
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  configuredStorageProviderName,
  verifyStorageSignature,
} from "@/lib/providers/storage/index.server";

export const dynamic = "force-dynamic";

const LOCAL_ROOT = path.join(process.cwd(), "public", "uploads");

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
  if (!verifyStorageSignature(key, expires, sig)) {
    return NextResponse.json(
      { error: { message: "This link is invalid or has expired" } },
      { status: 403 },
    );
  }

  // Last line before a filesystem read — keys are server-generated, but this
  // does not assume that.
  const resolved = path.resolve(LOCAL_ROOT, key);
  if (!resolved.startsWith(LOCAL_ROOT + path.sep)) {
    return NextResponse.json({ error: { message: "Bad request" } }, { status: 400 });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(resolved);
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
