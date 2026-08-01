"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { callGateway } from "@/lib/gateway/client";
import type { Message } from "@/lib/repositories/types";
import { Alert, Button, Card, Field, Spinner, Textarea } from "@/components/ui";

export function ComposeFirstMessage({ recipientId }: { recipientId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    setSending(true);
    setError(null);
    try {
      // Omitting conversationId is what tells the service to find-or-create
      // the thread for this pair.
      const message = await callGateway<Message>("messages.send", {
        recipientId,
        text: trimmed,
      });
      router.replace(`/messages/${message.conversationId}`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't send that message.",
      );
      setSending(false);
    }
  };

  return (
    <form onSubmit={send} className="space-y-6">
      <Card className="p-6">
        <Field label="Message" htmlFor="text">
          <Textarea
            id="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
            maxLength={4000}
            rows={6}
            placeholder="Introduce yourself and what you need…"
          />
        </Field>
      </Card>

      {error ? <Alert>{error}</Alert> : null}

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={sending || !text.trim()}>
          {sending ? <Spinner className="h-4 w-4" /> : null}
          Send message
        </Button>
      </div>
    </form>
  );
}
