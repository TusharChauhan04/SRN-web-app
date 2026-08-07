"use client";

/**
 * Multi-file document upload for identity verification.
 *
 * Separate from `ImageUploadField` because this one tracks upload IDS rather
 * than URLs. KYC documents are private: their read URLs are short-lived and
 * signed, so holding one in form state would produce a dead link by the time it
 * was submitted. The id is stable; the server resolves it to a storage key.
 */
import { useRef, useState } from "react";
import { callGateway } from "@/lib/gateway/client";
import { Button, Spinner } from "@/components/ui";

interface PreparedUpload {
  uploadId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

interface Attached {
  uploadId: string;
  fileName: string;
}

export function DocumentUploadField({
  uploadIds,
  onChange,
  max = 5,
}: {
  uploadIds: string[];
  onChange: (ids: string[]) => void;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [attached, setAttached] = useState<Attached[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (uploadIds.length >= max) {
      setError(`You can attach at most ${max} files.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // Server validates type and size before issuing a target — a PDF or
      // image only, under 15MB. The accept attribute is convenience.
      const prepared = await callGateway<PreparedUpload>("uploads.prepare", {
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        context: "document",
      });

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

      await callGateway("uploads.confirm", { uploadId: prepared.uploadId });

      setAttached((prev) => [
        ...prev,
        { uploadId: prepared.uploadId, fileName: file.name },
      ]);
      onChange([...uploadIds, prepared.uploadId]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = (uploadId: string) => {
    setAttached((prev) => prev.filter((a) => a.uploadId !== uploadId));
    onChange(uploadIds.filter((id) => id !== uploadId));
  };

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium">Documents</span>

      {attached.length > 0 ? (
        <ul className="space-y-2">
          {attached.map((file) => (
            <li
              key={file.uploadId}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate">{file.fileName}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => remove(file.uploadId)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className="sr-only"
        id="kyc-document"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy || uploadIds.length >= max}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Spinner className="h-4 w-4" /> : null}
        {attached.length === 0 ? "Attach a document" : "Attach another"}
      </Button>

      {error ? (
        <p role="alert" className="text-sm text-[var(--destructive-text)]">
          {error}
        </p>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">
          JPEG, PNG or PDF, up to 15MB each. Both sides if the document has them.
        </p>
      )}
    </div>
  );
}
