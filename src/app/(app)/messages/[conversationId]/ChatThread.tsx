"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Copy, FileText, Paperclip, Trash2, X } from "lucide-react";
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
/** Mirrors UPLOAD_RULES.chat on the server; the server is the boundary. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Decided by extension: the signed URL carries no content type to read. */
function isImage(name: string | null | undefined): boolean {
  return /.(jpe?g|png|webp|gif)$/i.test(name ?? "");
}

/** Bytes as something a person reads, e.g. "2.4 MB". */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

/**
 * Copy / delete, ported from mobile's long-press sheet (ChatScreen.tsx:128).
 *
 * The gateway operation `messages.delete` and its service existed from the
 * start — but nothing in the web UI ever called it, so deleting a message was
 * simply impossible here. Copy was ported to the referrals screen and missed on
 * this one. Both are restored.
 *
 * Delete is offered only for your own messages, matching mobile.
 */
function MessageActions({
  message,
  mine,
  onCopy,
  onDelete,
  busy,
}: {
  message: Message;
  mine: boolean;
  onCopy: (message: Message) => void;
  onDelete: (message: Message) => void;
  busy: boolean;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1",
        // Hidden until hover, but revealed on keyboard focus too — otherwise
        // these would be mouse-only.
        "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
      )}
    >
      <button
        type="button"
        onClick={() => onCopy(message)}
        title="Copy text"
        aria-label="Copy message text"
        className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:opacity-100"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      {mine ? (
        <button
          type="button"
          onClick={() => onDelete(message)}
          disabled={busy}
          title="Delete message"
          aria-label="Delete message"
          className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive-text)] disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
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
  /*
   * The chosen file is held here and uploaded on SEND, not on pick.
   *
   * Uploading on pick would leave an orphaned object in the bucket every time
   * someone attaches a file and then changes their mind — and those objects
   * are registered Uploads, so they would also follow the user into their GDPR
   * export forever.
   */
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  /** Transient feedback for copy/delete — distinct from the send error. */
  const [notice, setNotice] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  /**
   * Copy, with the execCommand fallback.
   *
   * `navigator.clipboard` is undefined on any non-secure origin, which includes
   * a plain-HTTP staging box. Without the fallback the button would silently do
   * nothing there — worse than not offering it.
   */
  const copyText = useCallback((message: Message) => {
    const done = () => {
      setNotice("Copied");
      window.setTimeout(() => setNotice(null), 1500);
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard
        .writeText(message.text)
        .then(done)
        .catch(() => setNotice("Couldn't copy that."));
      return;
    }
    const field = document.createElement("textarea");
    field.value = message.text;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    try {
      document.execCommand("copy");
      done();
    } catch {
      setNotice("Couldn't copy that.");
    } finally {
      document.body.removeChild(field);
    }
  }, []);

  const deleteMessage = useCallback(
    async (message: Message) => {
      if (!window.confirm("Delete this message? This can't be undone.")) return;

      setDeletingId(message.id);
      // Optimistic. The row is soft-deleted server-side and filtered out of the
      // next poll anyway, so removing it now only saves a five-second wait.
      const previous = messages;
      setMessages((current) => current.filter((m) => m.id !== message.id));
      try {
        await callGateway("messages.delete", {
          conversationId,
          messageId: message.id,
        });
      } catch (err) {
        // Put it back. A message that vanishes on a FAILED delete is worse than
        // one that never left.
        setMessages(previous);
        setNotice(
          err instanceof Error ? err.message : "Couldn't delete that message.",
        );
      } finally {
        setDeletingId(null);
      }
    },
    [conversationId, messages],
  );

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    pinnedToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    // Either half is enough: a photo with no caption is a real message.
    if ((!trimmed && !file) || !counterpart || sending) return;

    setSending(true);
    setError(null);
    // Clear immediately so the input feels responsive.
    setText("");

    try {
      let attachmentUploadId: string | undefined;
      if (file) {
        // Server-side validation of type and size happens in prepare; the
        // accept attribute below is a convenience, not the boundary.
        const prepared = await callGateway<{
          uploadId: string;
          uploadUrl: string;
          headers?: Record<string, string>;
        }>("uploads.prepare", {
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          context: "chat",
        });

        const put = await fetch(prepared.uploadUrl, {
          method: "PUT",
          headers: prepared.headers,
          body: file,
        });
        if (!put.ok) throw new Error("The file couldn't be uploaded.");

        await callGateway("uploads.confirm", { uploadId: prepared.uploadId });
        attachmentUploadId = prepared.uploadId;
      }

      const message = await callGateway<Message>("messages.send", {
        recipientId: counterpart.id,
        text: trimmed,
        conversationId,
        ...(attachmentUploadId && { attachmentUploadId }),
      });
      setMessages((previous) => [...previous, message]);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
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
                className={cn(
                  "group flex items-center gap-2",
                  mine ? "justify-end" : "justify-start",
                )}
              >
                {/*
                 * Message actions. Mobile puts these behind a long-press
                 * (ChatScreen.tsx:128) — a gesture with no web equivalent, so
                 * they surface on hover and on keyboard focus instead. The
                 * buttons stay in the DOM rather than being conditionally
                 * rendered, so they are reachable by Tab, not just by mouse.
                 *
                 * Ordered so the controls sit outside the bubble on the side
                 * the bubble is aligned to.
                 */}
                {mine ? (
                  <MessageActions
                    message={message}
                    mine={mine}
                    onCopy={copyText}
                    onDelete={deleteMessage}
                    busy={deletingId === message.id}
                  />
                ) : null}

                <div
                  /*
                   * Both sides stay filled rather than going soft. A bubble is
                   * the one surface here that must be attributable at a glance,
                   * and two same-colour extrusions differing only in shadow
                   * direction is not a reliable way to tell who said what.
                   * The extrusion is additive; the fill still does the work.
                   */
                  className={cn(
                    "max-w-[75%] rounded-2xl nm-raised-sm px-4 py-2.5 text-sm",
                    mine
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--muted)] text-[var(--foreground)]",
                  )}
                >
                  {message.attachmentUrl ? (
                    /*
                     * The URL here is a short-lived signed link minted by
                     * getThread for participants only — it is not stored, and
                     * it expires. That is why the thread refetches rather than
                     * caching message bodies indefinitely.
                     *
                     * Images render inline because that is the point of sending
                     * one; anything else gets a named row, since a PDF preview
                     * in a chat bubble helps nobody.
                     */
                    <a
                      href={message.attachmentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mb-2 block"
                    >
                      {isImage(message.attachmentName) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={message.attachmentUrl}
                          alt={message.attachmentName ?? "Attachment"}
                          className="max-h-64 w-auto rounded-lg"
                        />
                      ) : (
                        <span
                          className={cn(
                            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm underline-offset-2 hover:underline",
                            mine ? "bg-black/15" : "bg-[var(--background)]",
                          )}
                        >
                          <FileText className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">
                            {message.attachmentName ?? "Attachment"}
                          </span>
                          {message.attachmentSize ? (
                            <span className="shrink-0 text-xs opacity-70">
                              {formatFileSize(Number(message.attachmentSize))}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </a>
                  ) : null}
                  {message.text ? (
                    <p className="whitespace-pre-wrap break-words">
                      {message.text}
                    </p>
                  ) : null}
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

                {!mine ? (
                  <MessageActions
                    message={message}
                    mine={mine}
                    onCopy={copyText}
                    onDelete={deleteMessage}
                    busy={false}
                  />
                ) : null}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {error ? (
        <p role="alert" className="pb-2 text-sm text-[var(--destructive-text)]">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="pb-2 text-sm text-[var(--muted-foreground)]">
          {notice}
        </p>
      ) : null}

      <form
        onSubmit={send}
        className="flex flex-col gap-2 border-t border-[var(--border)] pt-4"
      >
        {file ? (
          /*
           * The chosen file, shown before it is sent. It has not been uploaded
           * yet — that happens on send — so removing it here costs nothing and
           * leaves nothing behind.
           */
          <div className="flex items-center gap-2 rounded-lg bg-[var(--muted)] px-3 py-2 text-sm">
            <Paperclip className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
              {formatFileSize(file.size)}
            </span>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                if (fileInput.current) fileInput.current.value = "";
              }}
              className="shrink-0 rounded p-1 text-[var(--muted-foreground)] hover:text-[var(--destructive-text)]"
              aria-label={`Remove ${file.name}`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => {
              const chosen = e.target.files?.[0] ?? null;
              if (chosen && chosen.size > MAX_ATTACHMENT_BYTES) {
                setError("That file is larger than 10MB.");
                e.target.value = "";
                return;
              }
              setError(null);
              setFile(chosen);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Attach a file"
            disabled={sending || !counterpart}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a message…"
            maxLength={4000}
            aria-label="Message"
            disabled={!counterpart}
          />
          <Button
            type="submit"
            disabled={sending || (!text.trim() && !file) || !counterpart}
          >
            {sending ? <Spinner className="h-4 w-4" /> : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}
