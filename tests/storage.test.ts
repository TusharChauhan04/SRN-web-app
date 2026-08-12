import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { storageProvider } from "@/lib/providers/storage/index.server";

/**
 * Exercises the configured storage provider against a REAL bucket.
 *
 * Every provider in this repo before now was "reviewed, never run" — the
 * Firebase one is still a stub that throws — so a provider that only typechecks
 * is exactly the failure mode this suite exists to prevent.
 *
 * SKIPPED unless STORAGE_PROVIDER=supabase and the three credentials are set.
 * CI has none of those, so it does not run there and does not need a bucket;
 * the point is that it CAN be run, and was.
 *
 * It writes one object under a `document/storage-selftest/` prefix and removes
 * it again in a finally block. `document` deliberately, because that is the
 * context with the strictest requirement — a signed, expiring URL — and it is
 * the one worth proving.
 */
/*
 * `__REAL_STORAGE_PROVIDER`, not `STORAGE_PROVIDER` — tests/setup.ts forces the
 * latter to "local" so no ordinary test can reach a live bucket, and reading it
 * here made this file skip itself while the suite still reported success.
 */
/*
 * OPT-IN, not merely "configured".
 *
 * This file WRITES to whatever bucket is configured. tests/global-setup.ts
 * refuses `?schema=public` precisely because a URL cannot tell development from
 * production — and the same is true of a bucket name. Without an explicit
 * opt-in, running `pnpm test` with a production .env loaded would drop a
 * selftest object into the bucket holding real KYC documents, and a failed
 * cleanup would leave it there quietly.
 *
 * So the bucket has to be named a second time, in a variable that exists for no
 * other purpose. Set STORAGE_TEST_BUCKET to the same value as
 * SUPABASE_STORAGE_BUCKET to run these; leave it unset and they skip.
 */
const OPTED_IN =
  Boolean(process.env.STORAGE_TEST_BUCKET) &&
  process.env.STORAGE_TEST_BUCKET === process.env.SUPABASE_STORAGE_BUCKET;

const CONFIGURED =
  OPTED_IN &&
  process.env.__REAL_STORAGE_PROVIDER === "supabase" &&
  Boolean(process.env.SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  // Both buckets — the provider refuses to construct without them.
  Boolean(process.env.SUPABASE_STORAGE_BUCKET_PUBLIC);

// Restore the real selection for THIS file only. Safe because the provider is
// constructed lazily on first use and vitest isolates modules per test file, so
// nothing else has already cached a LocalStorageProvider here.
if (CONFIGURED) process.env.STORAGE_PROVIDER = "supabase";

describe.skipIf(!CONFIGURED)("supabase storage round trip", () => {
  it("uploads, reads through a signed URL, reports existence, and deletes", async () => {
    const provider = storageProvider();
    expect(provider.name).toBe("supabase");
    expect(provider.isConfigured).toBe(true);

    const storageKey = `document/storage-selftest/${randomUUID()}.txt`;
    const payload = `selftest ${Date.now()}`;
    let uploaded = false;

    try {
      // 1. A signed upload target the CLIENT can PUT to — the bytes must never
      //    pass through our own request handler.
      const target = await provider.createUploadTarget({
        storageKey,
        mimeType: "text/plain",
        context: "document",
      });
      expect(target.uploadUrl).toMatch(/^https:\/\//);
      expect(target.storageKey).toBe(storageKey);

      // 2. Upload exactly as a browser would: no service key, only the signature.
      const put = await fetch(target.uploadUrl, {
        method: "PUT",
        headers: target.headers,
        body: payload,
      });
      expect(
        put.ok,
        `upload failed: ${put.status} ${await put.text().catch(() => "")}`,
      ).toBe(true);
      uploaded = true;

      // 3. exists() must reflect reality. `uploads.confirm` used to take the
      //    client's word for it, leaving "confirmed" rows pointing at nothing.
      expect(await provider.exists(storageKey)).toBe(true);

      // 4. A document read must be SIGNED and time-limited, never a bare public
      //    URL — this is the KYC guarantee.
      const readUrl = await provider.getReadUrl(storageKey, "document");
      expect(readUrl).toMatch(/^https:\/\//);
      expect(
        readUrl,
        "a document URL must be signed, not the public object path",
      ).toContain("token=");
      expect(readUrl).not.toContain("/object/public/");

      // 5. And it must actually serve the bytes we wrote.
      const got = await fetch(readUrl);
      expect(got.ok, `signed read failed: ${got.status}`).toBe(true);
      expect(await got.text()).toBe(payload);

      // 6. The same object WITHOUT a signature must not be readable.
      const bucket = process.env.SUPABASE_STORAGE_BUCKET!;
      const unsigned = `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${storageKey}`;
      const anon = await fetch(unsigned);
      expect(
        anon.ok,
        "an unsigned URL served a KYC document — the bucket is public",
      ).toBe(false);
    } finally {
      // Always clean up, including when an assertion above threw.
      if (uploaded) await provider.delete(storageKey).catch(() => {});
    }

    // 7. delete() must be observable, not fire-and-forget.
    expect(await provider.exists(storageKey)).toBe(false);
  });

  it("serves an avatar publicly, from the public bucket", async () => {
    /*
     * The other half of the split, and the half that had no coverage.
     *
     * A single bucket has no correct setting: private and this test fails
     * (every avatar 400s, and confirmUpload persists the dead URL so it never
     * heals); public and the document test above fails (KYC identity documents
     * readable by anyone holding the key). The two tests can only pass together
     * when the buckets are actually separate, which is the property worth
     * pinning down.
     */
    const provider = storageProvider();
    const storageKey = `avatar/storage-selftest/${randomUUID()}.txt`;
    const payload = `avatar selftest ${Date.now()}`;
    let uploaded = false;

    try {
      const target = await provider.createUploadTarget({
        storageKey,
        mimeType: "text/plain",
        context: "avatar",
      });

      const put = await fetch(target.uploadUrl, {
        method: "PUT",
        headers: target.headers,
        body: payload,
      });
      expect(
        put.ok,
        `upload failed: ${put.status} ${await put.text().catch(() => "")}`,
      ).toBe(true);
      uploaded = true;

      // Derived from the key prefix, with no context argument — this is the
      // path exists()/delete() take, so it proves that derivation works.
      expect(await provider.exists(storageKey)).toBe(true);

      const readUrl = await provider.getReadUrl(storageKey, "avatar");
      expect(readUrl).toContain("/object/public/");
      expect(readUrl).toContain(process.env.SUPABASE_STORAGE_BUCKET_PUBLIC!);
      // No signature: avatars are rendered in long-lived pages, and a 15-minute
      // token would break them on screen.
      expect(readUrl).not.toContain("token=");

      // UNAUTHENTICATED fetch must succeed — the inverse of the document case.
      const anon = await fetch(readUrl);
      expect(
        anon.ok,
        `public read failed (${anon.status}) — is ${process.env.SUPABASE_STORAGE_BUCKET_PUBLIC} marked public?`,
      ).toBe(true);
      expect(await anon.text()).toBe(payload);
    } finally {
      if (uploaded) await provider.delete(storageKey).catch(() => {});
    }

    expect(await provider.exists(storageKey)).toBe(false);
  });

  it("routes each context to its own bucket at upload time", async () => {
    /*
     * Checked on the UPLOAD target, not a read URL. Signing a read requires the
     * object to already exist — my first version asserted against a key that did
     * not, and Supabase answered 400. The upload target is where the routing
     * decision is actually made, so it is the honest place to assert it, and it
     * needs no fixture.
     */
    const provider = storageProvider();
    const priv = process.env.SUPABASE_STORAGE_BUCKET!;
    const pub = process.env.SUPABASE_STORAGE_BUCKET_PUBLIC!;
    expect(priv).not.toBe(pub);

    const doc = await provider.createUploadTarget({
      storageKey: `document/x/${randomUUID()}.pdf`,
      mimeType: "application/pdf",
      context: "document",
    });
    expect(doc.uploadUrl).toContain(priv);
    expect(doc.uploadUrl).not.toContain(pub);

    const avatar = await provider.createUploadTarget({
      storageKey: `avatar/x/${randomUUID()}.png`,
      mimeType: "image/png",
      context: "avatar",
    });
    expect(avatar.uploadUrl).toContain(pub);
  });

  it("treats deleting an absent object as success", async () => {
    // Already gone IS the desired end state. Anything else must throw — a
    // blanket catch here is what made the GDPR erasure guard unreachable for
    // the local provider.
    await expect(
      storageProvider().delete(`document/storage-selftest/${randomUUID()}.txt`),
    ).resolves.toBeUndefined();
  });
});
