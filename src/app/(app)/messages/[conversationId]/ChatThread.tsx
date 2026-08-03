"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { callGateway } from "@/lib/gateway/client";
import type { Message } from "@/lib/repositories/types";
import { Avatar, Button, Input, Spinner, cn } from "@/components/ui";

/**
 * Poll cadences ported verbatim from mobile's ChatScreen — messages every 5s,
 * presence every 30s, read receipts debounced. Mobile has no realtime listener
 * despite appearances (see WEB_MIGRATION_PLAN.md §0.1), so this is parity, not
 * a downgrade.
 */
const MESSAGE_POLL_MS = 5_000;
const PRESENCE_POLL_MS = 30_000;

/**
 * Cheap fingerprint of what the UI actually renders.
 *
 * Anything that changes the rendered output must be in here, or the poll will
 * treat a real change as no change and silently stop updating.
 */
function digestOf(messages: Message[]): string {
  return messages.map((m) => `${m.id}:${m.read ? 1 : 0}`).join(",");
}

interface ThreadResponse {
  messages: Message[];
  counterpartOnline: boolean;
}

export function ChatThread({
  conversationId,
  currentUserId,
  initialMessages,
  counterpart,
  initiallyOnline,
}: {
  conversationId: string;
  currentUserId: string;
  initialMessages: Message[];
  counterpart: { id: string; name: string; avatarUrl: string | null } | null;
  initiallyOnline: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [online, setOnline] = useState(initiallyOnline);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll when the user is already at the bottom, so polling can't
  // yank them away from something they're reading further up.
  const pinnedToBottom = useRef(true);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "end",
    });
  }, []);

  useEffect(() => {
    scrollToBottom(false);
  }, [scrollToBottom]);

  // ── Message polling ──────────────────────────────────────────────────────
  /*
   * Self-scheduling, not setInterval, and paused while the tab is hidden.
   *
   * `setInterval` fires on a fixed clock regardless of what came before, which
   * fails in two compounding ways:
   *
   *   - No in-flight guard. When the server slows past the interval, requests
   *     STACK — load rises exactly as the server degrades. That is the standard
   *     way polling turns a slowdown into an outage.
   *   - No visibility check. A background tab left open all day polled ~17,000
   *     times, each costing a session verification and five queries, for a
   *     screen nobody was looking at.
   *
   * Re-arming only after the previous request settles fixes the first; skipping
   * hidden tabs and refreshing once on return fixes the second.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(() => void poll(), MESSAGE_POLL_MS);
    };

    const poll = async () => {
      // Skip the round trip entirely when nobody is looking, but keep the timer
      // alive so polling resumes without waiting for a visibility event.
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }
      try {
        const data = await callGateway<ThreadResponse>("messages.thread", {
          conversationId,
        });
        if (cancelled) return;

        setMessages((previous) => {
          /*
           * Only re-render when something actually changed, or every poll
           * rebuilds the list and fights the scroll position.
           *
           * The digest includes `read`, not just ids and length. Comparing
           * only those meant a counterpart reading your messages changed
           * neither — so the "· Read" label never appeared, because the poll
           * classified a genuine change as no change.
           */
          if (digestOf(previous) === digestOf(data.messages)) return previous;

          if (pinnedToBottom.current) {
            requestAnimationFrame(() => scrollToBottom());
          }
          return data.messages;
        });
        setOnline(data.counterpartOnline);
      } catch {
        // Transient failure — the next tick retries. Don't surface an error
        // banner for a poll the user didn't ask for.
      } finally {
        // Re-arm only now. This is the in-flight guard: there is never more
        // than one request outstanding, however slow the server gets.
        schedule();
      }
    };

    // Catch up immediately when the tab comes back, rather than showing stale
    // messages until the next tick.
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [conversationId, scrollToBottom]);

  // ── Presence heartbeat, so the other side sees us online ────────────────
  useEffect(() => {
    const beat = () => {
      // A hidden tab is not presence. Beating from one told the other side you
      // were "Online" while the laptop was shut, and cost a write per beat.
      if (document.hidden) return;
      void callGateway("presence.heartbeat").catch(() => {});
    };
    beat();
    const id = setInterval(beat, PRESENCE_POLL_MS);
    return () => clearInterval(id);
  }, []);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    pinnedToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !counterpart || sending) return;

    setSending(true);
    setError(null);
    // Clear immediately so the input feels responsive.
    setText("");

    try {
      const message = await callGateway<Message>("messages.send", {
        recipientId: counterpart.id,
        text: trimmed,
        conversationId,
      });
      setMessages((previous) => [...previous, message]);
      pinnedToBottom.current = true;
      requestAnimationFrame(() => scrollToBottom());
    } catch (err) {
      // Put the text back so it isn't lost.
      setText(trimmed);
      setError(
        err instanceof Error ? err.message : "Couldn't send that message.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--border)] pb-4">
        <Link
          href="/messages"
          className="text-sm text-[var(--muted-foreground)] hover:underline lg:hidden"
        >
          ← Back
        </Link>
        <Avatar name={counterpart?.name ?? "?"} src={counterpart?.avatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {counterpart?.name ?? "Unknown"}
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {online ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Online
              </span>
            ) : (
              "Offline"
            )}
          </p>
        </div>
        {counterpart ? (
          <Link
            href={`/providers/${counterpart.id}`}
            className="text-sm text-[var(--primary)] hover:underline"
          >
            Profile
          </Link>
        ) : null}
      </header>

      <div onScroll={onScroll} className="flex-1 space-y-3 overflow-y-auto py-4">
        {messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">
            No messages yet. Say hello.
          </p>
        ) : (
          messages.map((message) => {
            const mine = message.senderId === currentUserId;
            return (
              <div
                key={message.id}
                className={cn("flex", mine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm",
                    mine
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--muted)] text-[var(--foreground)]",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">
                    {message.text}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-[10px]",
                      mine ? "opacity-70" : "text-[var(--muted-foreground)]",
                    )}
                  >
                    {new Date(message.createdAt).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {mine && message.read ? " · Read" : ""}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {error ? (
        <p role="alert" className="pb-2 text-sm text-[var(--destructive)]">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={send}
        className="flex items-center gap-2 border-t border-[var(--border)] pt-4"
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a message…"
          maxLength={4000}
          aria-label="Message"
          disabled={!counterpart}
        />
        <Button type="submit" disabled={sending || !text.trim() || !counterpart}>
          {sending ? <Spinner className="h-4 w-4" /> : "Send"}
        </Button>
      </form>
    </div>
  );
}
