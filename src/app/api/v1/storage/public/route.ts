/**
 * Unsigned read for PUBLIC assets — avatars and portfolio images only.
 *
 * These used to be served straight off the static `/uploads/...` path, which
 * also exposed KYC documents and dispute evidence to anyone who learned a key
 * (see LOCAL_ROOT). The upload directory moved out of the web root, so public
 * assets need a route of their own.
 *
 * This route deliberately has NO signature and NO expiry: avatars are rendered
 * in long-lived pages and a 15-minute token would make them break on screen.
 * What it does instead is refuse, by context prefix, to serve anything that is
 * not public — so it cannot become a way around the signed route.
 */
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  LOCAL_ROOT,
  configuredStorageProviderName,
  resolveLocalPath,
} from "@/lib/providers/storage/index.server";

export const dynamic = "force-dynamic";

/**
 * Storage keys are `${context}/${userId}/${uuid}.${ext}` (see
 * provider.service.ts). Only these two contexts are public; `document` and
 * `evidence` are identity material and must go through the signed route.
 */
const PUBLIC_PREFIXES = ["avatar", "portfolio"];

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(req: Request) {
  if (configuredStorageProviderName() !== "local") {
    return NextResponse.json(
      { error: { message: "Not found" } },
      { status: 404 },
    );
  }

  const key = new URL(req.url).searchParams.get("key");
  if (!key) {
    // 404 rather than 403: a caller probing for document keys learns nothing
    // about whether one exists.
    return NextResponse.json(
      { error: { message: "Not found" } },
      { status: 404 },
    );
  }

  /*
   * Decide on the RESOLVED path, never the raw key.
   *
   * Checking `key.startsWith("avatar/")` was bypassable, because the key is
   * normalized afterwards: `avatar/../document/<uid>/<uuid>.png` passes a
   * prefix test on the raw string, resolves to `LOCAL_ROOT/document/…`, stays
   * inside LOCAL_ROOT so the traversal guard never fires, and was then served
   * unsigned, uncached-busted and `immutable`. That handed back exactly the
   * unauthenticated access to KYC documents that moving LOCAL_ROOT out of
   * `public/` was meant to remove — and the extension filter did not help,
   * because `document` and `evidence` both permit image/jpeg and image/png.
   *
   * `resolveLocalPath` normalizes and confirms containment in LOCAL_ROOT; the
   * check below then confirms which SUBDIRECTORY the real path lands in.
   */
  let resolved: string;
  try {
    resolved = resolveLocalPath(key);
  } catch {
    return NextResponse.json(
      { error: { message: "Not found" } },
      { status: 404 },
    );
  }

  const isPublicObject = PUBLIC_PREFIXES.some((prefix) =>
    resolved.startsWith(path.join(LOCAL_ROOT, prefix) + path.sep),
  );
  if (!isPublicObject) {
    return NextResponse.json(
      { error: { message: "Not found" } },
      { status: 404 },
    );
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(resolved);
  } catch {
    return NextResponse.json(
      { error: { message: "Not found" } },
      { status: 404 },
    );
  }

  const extension = key.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) {
    // The upload path allows only image extensions for these contexts, so
    // anything else here is unexpected — don't guess a type for it.
    return NextResponse.json(
      { error: { message: "Not found" } },
      { status: 404 },
    );
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      // Content is immutable — the key contains a uuid, so a changed avatar is
      // a different key.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // Even for images: an uploaded file must never render as a document in
      // our origin.
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
