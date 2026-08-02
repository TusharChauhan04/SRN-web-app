"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { callGateway } from "@/lib/gateway/client";
import {
  Alert,
  Button,
  Card,
  Field,
  Select,
  Spinner,
} from "@/components/ui";
import { DocumentUploadField } from "@/components/upload/DocumentUploadField";

const DOC_TYPES = [
  { value: "aadhaar", label: "Aadhaar" },
  { value: "pan", label: "PAN card" },
  { value: "gst", label: "GST certificate" },
  { value: "license", label: "Professional licence" },
  { value: "other", label: "Other government ID" },
] as const;

export function KycSubmitForm({
  isResubmission,
}: {
  isResubmission: boolean;
}) {
  const router = useRouter();
  const [docType, setDocType] = useState<string>("");
  const [uploadIds, setUploadIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docType || uploadIds.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      await callGateway("kyc.submit", { docType, uploadIds });
      router.refresh();
      setUploadIds([]);
      setDocType("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit those.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Card className="space-y-5 p-6">
        <Field label="Document type" htmlFor="docType">
          <Select
            id="docType"
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            required
          >
            <option value="" disabled>
              Choose a document
            </option>
            {DOC_TYPES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>

        <DocumentUploadField
          uploadIds={uploadIds}
          onChange={setUploadIds}
          max={5}
        />

        {error ? <Alert>{error}</Alert> : null}

        <Button
          type="submit"
          disabled={busy || !docType || uploadIds.length === 0}
        >
          {busy ? <Spinner className="h-4 w-4" /> : null}
          {isResubmission ? "Resubmit for review" : "Submit for review"}
        </Button>
      </Card>
    </form>
  );
}
