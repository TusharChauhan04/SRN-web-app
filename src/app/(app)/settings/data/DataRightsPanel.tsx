"use client";

import { useActionState, useState } from "react";
import { callGateway } from "@/lib/gateway/client";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Input,
  Spinner,
} from "@/components/ui";
import type { DataState } from "./page";

export function DataRightsPanel({
  deletionRequested,
  requestAction,
  cancelAction,
}: {
  deletionRequested: boolean;
  requestAction: (prev: DataState, formData: FormData) => Promise<DataState>;
  cancelAction: () => Promise<void>;
}) {
  const [state, formAction, pending] = useActionState<DataState, FormData>(
    requestAction,
    {},
  );
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const downloadExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const bundle = await callGateway<Record<string, unknown>>("gdpr.export");

      // Built and downloaded client-side: the bundle is already in memory from
      // the gateway response, so round-tripping it through a file endpoint
      // would only duplicate the work.
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `srn-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Couldn't build your export.",
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader
          title="Download your data"
          description="A JSON file containing everything listed above."
        />
        <div className="space-y-3 p-5">
          {exportError ? <Alert>{exportError}</Alert> : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => void downloadExport()}
            disabled={exporting}
          >
            {exporting ? <Spinner className="h-4 w-4" /> : null}
            Download export
          </Button>
        </div>
      </Card>

      <Card className="outline-2 outline-[var(--destructive-text)]">
        <CardHeader
          title="Close your account"
          description="This removes your personal data and your sign-in."
        />
        <div className="space-y-4 p-5">
          {deletionRequested ? (
            <form action={cancelAction}>
              <p className="mb-3 text-sm text-[var(--muted-foreground)]">
                Changed your mind? Cancelling restores your account fully.
              </p>
              <Button type="submit" variant="outline">
                Cancel deletion
              </Button>
            </form>
          ) : !open ? (
            <>
              <p className="text-sm text-[var(--muted-foreground)]">
                Your bookings and the reviews you left stay, with your name
                removed — deleting them outright would rewrite other
                people&apos;s history. Everything that identifies you, including
                your uploaded files, is erased.
              </p>
              <Button variant="danger" onClick={() => setOpen(true)}>
                Request account deletion
              </Button>
            </>
          ) : (
            <form action={formAction} className="space-y-4">
              <Alert>
                <strong>This is scheduled, then permanent.</strong> You&apos;ll
                have a grace period to cancel. After that, your personal data and
                stored files are erased and your sign-in stops working. It
                cannot be undone.
              </Alert>

              <div className="max-w-sm">
                <label
                  htmlFor="confirm-delete"
                  className="mb-1 block text-sm font-medium"
                >
                  Type <span className="font-mono">DELETE</span> to confirm
                </label>
                <Input
                  id="confirm-delete"
                  name="confirm"
                  autoComplete="off"
                  placeholder="DELETE"
                  required
                />
              </div>

              {state.error ? <Alert>{state.error}</Alert> : null}
              {state.ok ? <Alert tone="info">{state.ok}</Alert> : null}

              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="danger" disabled={pending}>
                  {pending ? <Spinner className="h-4 w-4" /> : null}
                  Schedule deletion
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  Keep my account
                </Button>
              </div>
            </form>
          )}
        </div>
      </Card>
    </>
  );
}
