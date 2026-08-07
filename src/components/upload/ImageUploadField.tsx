"use client";

/**
 * File upload control.
 *
 * Runs the same three-step flow mobile used (`src/lib/uploadService.ts`):
 * ask the server for a target, PUT the bytes straight to storage, then confirm.
 * The bytes never pass through a request handler.
 *
 * Mobile had no image-picker library — `uploadService` took a URI it was handed
 * — so a plain file input is full parity here, not a downgrade.
 */
import { useRef, useState } from "react";
import { callGateway } from "@/lib/gateway/client";
import { Button, Spinner } from "@/components/ui";

type UploadContext = "avatar" | "portfolio" | "document" | "evidence";

const ACCEPT: Record<UploadContext, string> = {
  avatar: "image/jpeg,image/png,image/webp",
  portfolio: "image/jpeg,image/png,image/webp",
  document: "image/jpeg,image/png,application/pdf",
  evidence: "image/jpeg,image/png,application/pdf",
};

interface PreparedUpload {
  uploadId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

export function ImageUploadField({
  context,
  label,
  hint,
  value,
  onChange,
  entityId,
}: {
  context: UploadContext;
  label: string;
  hint?: string;
  value: string;
  onChange: (url: string) => void;
  entityId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);

    try {
      // 1. Server validates type and size and issues a short-lived target.
      //    The accept attribute above is a convenience, not the control.
      const prepared = await callGateway<PreparedUpload>("uploads.prepare", {
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        context,
        entityId,
      });

      // 2. Bytes go straight to storage.
      const put = await fetch(prepared.uploadUrl, {
        method: "PUT",
        headers: prepared.headers,
        body: file,
      });
      if (!put.ok) {
        const body = (await put.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? "The upload was rejected.");
      }

      // 3. Confirm, which is what makes it usable and returns a readable URL.
      const confirmed = await callGateway<{ publicUrl: string | null }>(
        "uploads.confirm",
        { uploadId: prepared.uploadId },
      );

      if (!confirmed.publicUrl) throw new Error("The upload didn't complete.");
      onChange(confirmed.publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      // Reset so re-picking the same file fires a change event.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const isImage = context === "avatar" || context === "portfolio";

  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>

      {value && isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value}
          alt=""
          className="aspect-video w-full max-w-sm rounded-xl border border-[var(--border)] object-cover"
        />
      ) : null}

      {value && !isImage ? (
        <p className="text-sm text-[var(--muted-foreground)]">File attached.</p>
      ) : null}

      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT[context]}
          className="sr-only"
          id={`upload-${context}-${entityId ?? "new"}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <Spinner className="h-4 w-4" /> : null}
          {value ? "Replace file" : "Choose file"}
        </Button>

        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange("")}
            disabled={busy}
          >
            Remove
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--destructive-text)]">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-[var(--muted-foreground)]">{hint}</p>
      ) : null}
    </div>
  );
}
