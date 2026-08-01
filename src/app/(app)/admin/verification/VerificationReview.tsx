"use client";

import { useActionState, useState } from "react";
import { callGateway } from "@/lib/gateway/client";
import {
  Alert,
  Button,
  Field,
  Spinner,
  Textarea,
} from "@/components/ui";
import {
  approveVerification,
  rejectVerification,
  type AdminState,
} from "../actions";

interface DocumentsResponse {
  documentUrls: string[];
}

/**
 * Review controls for one KYC request.
 *
 * Document links are fetched ON DEMAND rather than with the queue listing, so
 * simply opening the page doesn't mint signed read URLs for every identity
 * document in the queue — and the audit entry records who actually looked.
 */
export function VerificationReview({ requestId }: { requestId: string }) {
  const [docs, setDocs] = useState<string[] | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  const [approveState, approveAction, approving] = useActionState<
    AdminState,
    FormData
  >(approveVerification, {});
  const [rejectState, rejectAction, rejecting] = useActionState<
    AdminState,
    FormData
  >(rejectVerification, {});

  const done = approveState.ok ?? rejectState.ok;
  if (done) return <Alert tone="info">{done}</Alert>;

  const loadDocuments = async () => {
    setLoadingDocs(true);
    setDocError(null);
    try {
      const data = await callGateway<DocumentsResponse>(
        "admin.verification.documents",
        { requestId },
      );
      setDocs(data.documentUrls);
    } catch (err) {
      setDocError(
        err instanceof Error ? err.message : "Couldn't load the documents.",
      );
    } finally {
      setLoadingDocs(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        {docs === null ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadDocuments()}
            disabled={loadingDocs}
          >
            {loadingDocs ? <Spinner className="h-4 w-4" /> : null}
            View identity documents
          </Button>
        ) : docs.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No documents attached.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {docs.map((url, index) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
                >
                  Document {index + 1}
                </a>
              </li>
            ))}
          </ul>
        )}

        {docError ? (
          <p role="alert" className="mt-2 text-sm text-[var(--destructive)]">
            {docError}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <form action={approveAction} className="space-y-2">
          <input type="hidden" name="requestId" value={requestId} />
          <Field
            label="Approve"
            htmlFor={`approve-note-${requestId}`}
            hint="Optional internal note."
          >
            <Textarea
              id={`approve-note-${requestId}`}
              name="note"
              maxLength={500}
              rows={2}
            />
          </Field>
          <Button type="submit" size="sm" disabled={approving || rejecting}>
            {approving ? <Spinner className="h-4 w-4" /> : null}
            Approve &amp; verify
          </Button>
          {approveState.error ? <Alert>{approveState.error}</Alert> : null}
        </form>

        <form action={rejectAction} className="space-y-2">
          <input type="hidden" name="requestId" value={requestId} />
          <Field
            label="Reject"
            htmlFor={`reject-note-${requestId}`}
            hint="Required. The user sees this, so say what to fix."
          >
            <Textarea
              id={`reject-note-${requestId}`}
              name="note"
              required
              minLength={5}
              maxLength={500}
              rows={2}
              placeholder="The document is cropped — please resubmit with all four corners visible."
            />
          </Field>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={approving || rejecting}
          >
            {rejecting ? <Spinner className="h-4 w-4" /> : null}
            Reject
          </Button>
          {rejectState.error ? <Alert>{rejectState.error}</Alert> : null}
        </form>
      </div>
    </div>
  );
}
