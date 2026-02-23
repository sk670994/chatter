"use client";

import { FormEvent, UIEvent, useEffect, useMemo, useRef, useState } from "react";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
};

type ChatResponse = {
  reply: string;
  conversationId: string;
  model: string;
  toolCallsUsed?: number;
  attemptedModels?: string[];
};

type ConversationTurn = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

type HistoryResponse = {
  conversationId: string;
  history: ConversationTurn[];
};

const DEFAULT_MODEL = "gemini-2.0-flash";
const CONVERSATION_KEY = "chatter:conversationId";
const AUTO_SCROLL_THRESHOLD = 80;
const QUICK_PROMPTS = [
  "Give me today's top AI news in 5 bullets.",
  "Draft a polite follow-up email for an interview.",
  "Explain event loop in JavaScript with a simple example.",
];

function createMessage(role: ChatRole, text: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    createdAt: new Date().toISOString(),
  };
}

export default function Home() {
  const [conversationId, setConversationId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  function mapHistoryToMessages(history: ConversationTurn[]): ChatMessage[] {
    return history
      .map((turn, index) => {
        const text = turn.parts.map((part) => part.text).join("\n").trim();
        if (!text) {
          return null;
        }

        return {
          id: `history-${index}`,
          role: turn.role === "model" ? "assistant" : "user",
          text,
          createdAt: new Date().toISOString(),
        } satisfies ChatMessage;
      })
      .filter((item): item is ChatMessage => Boolean(item));
  }

  useEffect(() => {
    const existing = localStorage.getItem(CONVERSATION_KEY);
    if (existing) {
      setConversationId(existing);
      return;
    }

    const newId = crypto.randomUUID();
    localStorage.setItem(CONVERSATION_KEY, newId);
    setConversationId(newId);
  }, []);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    let cancelled = false;
    setStatus("Loading history...");

    async function loadHistory() {
      try {
        const response = await fetch(`/api/history/${encodeURIComponent(conversationId)}`);
        if (!response.ok) {
          throw new Error(`History request failed with status ${response.status}`);
        }

        const data = (await response.json()) as HistoryResponse;
        if (cancelled) {
          return;
        }

        const restored = mapHistoryToMessages(data.history ?? []);
        setMessages(restored);
        setStatus(restored.length > 0 ? "History restored" : "Ready");
      } catch {
        if (cancelled) {
          return;
        }
        setStatus("Ready");
      }
    }

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !autoScrollEnabled) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, autoScrollEnabled]);

  const canSend = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);

  function handleMessagesScroll(event: UIEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    setAutoScrollEnabled(distanceFromBottom <= AUTO_SCROLL_THRESHOLD);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || !conversationId || isSending) {
      return;
    }

    setIsSending(true);
    setAutoScrollEnabled(true);
    setStatus("Sending message...");
    setInput("");
    setMessages((current) => [...current, createMessage("user", trimmed)]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: trimmed }),
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorPayload.error || `Request failed with status ${response.status}`);
      }

      const data: ChatResponse = await response.json();
      setModel(data.model || DEFAULT_MODEL);
      if (data.conversationId && data.conversationId !== conversationId) {
        setConversationId(data.conversationId);
        localStorage.setItem(CONVERSATION_KEY, data.conversationId);
      }

      setMessages((current) => [...current, createMessage("assistant", data.reply || "(No reply)")]);
      if (data.attemptedModels && data.attemptedModels.length > 1) {
        setStatus(`Ready - fallback used (${data.attemptedModels.join(" -> ")})`);
      } else if (data.toolCallsUsed) {
        setStatus(`Ready - tool calls used: ${data.toolCallsUsed}`);
      } else {
        setStatus("Ready");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected chat error";
      setMessages((current) => [
        ...current,
        createMessage("assistant", `I could not complete the request. ${message}`),
      ]);
      setStatus("Request failed");
    } finally {
      setIsSending(false);
    }
  }

  async function resetConversation() {
    if (conversationId) {
      try {
        await fetch(`/api/history/${encodeURIComponent(conversationId)}`, {
          method: "DELETE",
        });
      } catch {
        // Ignore history clear failures and continue with local reset.
      }
    }

    const newId = crypto.randomUUID();
    localStorage.setItem(CONVERSATION_KEY, newId);
    setConversationId(newId);
    setMessages([]);
    setStatus("Ready");
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_15%_10%,#ffd9d9_0%,#f6f6f2_30%,#dbeafe_75%,#f6f6f2_100%)] px-4 py-5 md:px-8 md:py-8">
      <main className="mx-auto flex h-[calc(100vh-2.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white/70 shadow-[0_20px_70px_rgba(15,23,42,0.16)] backdrop-blur-sm">
        <header className="relative overflow-hidden border-b border-slate-200 bg-[linear-gradient(110deg,#fff1f2_0%,#eff6ff_55%,#f8fafc_100%)] px-5 py-4 md:px-7">
          <div className="pointer-events-none absolute -right-6 -top-10 h-28 w-28 rounded-full bg-red-200/40 blur-2xl" />
          <div className="pointer-events-none absolute -left-10 -bottom-12 h-28 w-28 rounded-full bg-blue-200/50 blur-2xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h1  className=" text-5xl shadow-2xl font-extrabold uppercase tracking-[0.22em] text-slate-200 bg-teal-950">chatter </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full border border-slate-300 bg-white px-3 py-1 font-mono text-xs text-slate-700">{model}</span>
              <span className="rounded-full border border-slate-300 bg-white px-3 py-1 font-mono text-xs text-slate-700">ID: {conversationId ? `${conversationId.slice(0, 8)}...` : "..."}</span>
              <button
                type="button"
                onClick={resetConversation}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 font-medium text-slate-700 transition hover:bg-slate-100"
              >
                New Chat
              </button>
            </div>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 gap-0 md:grid-cols-[1fr_290px]">
          <div className="flex min-h-0 flex-col">
            {messages.length === 0 ? (
              <div className="border-b border-slate-200 bg-white/70 px-4 py-3 md:px-6">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Try a quick prompt</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setInput(prompt)}
                      className="rounded-full border border-slate-700 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:text-white hover:-translate-y-0.5 hover:border-slate-100 hover:bg-slate-900"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="relative min-h-0 flex-1">
              <div
                ref={messagesContainerRef}
                onScroll={handleMessagesScroll}
                className="chat-scroll min-h-0 h-full space-y-4 overflow-y-scroll scroll-smooth overscroll-contain bg-[linear-gradient(180deg,#fcfcff_0%,#f8fafc_100%)] px-4 py-4 md:px-6"
              >
                {messages.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-slate-600 shadow-sm">
                    <h2 className="text-lg font-semibold text-slate-800">Start a conversation</h2>
                    <p className="mt-2 text-sm">Ask anything. History is preserved per conversation and restored automatically.</p>
                  </div>
                ) : null}

                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={`message-fade max-w-[88%] rounded-2xl border px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.08)] ${
                      message.role === "user"
                        ? "ml-auto border-4 border-yellow-400 bg-[linear-gradient(135deg,#ef4444_0%,#dc2626_100%)] text-white"
                        : "border-slate-900 border-4  bg-[linear-gradient(135deg,#3b82f6_0%,#2563eb_100%)] text-white"
                    }`}
                  >
                    <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.16em] opacity-85">{message.role}</p>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.text}</p>
                  </article>
                ))}
              </div>
              {!autoScrollEnabled && messages.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setAutoScrollEnabled(true);
                    messagesContainerRef.current?.scrollTo({
                      top: messagesContainerRef.current.scrollHeight,
                      behavior: "smooth",
                    });
                  }}
                  className="absolute bottom-4 right-4 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-md transition hover:bg-slate-800"
                >
                  Jump to latest
                </button>
              ) : null}
            </div>

            <form onSubmit={sendMessage} className="shrink-0 border-t border-slate-200 bg-white px-4 py-4 md:px-6">
              <label htmlFor="chat-input" className="mb-2 block text-sm font-medium text-slate-700">
                Message
              </label>
              <div className="flex flex-col gap-3 md:flex-row">
                <textarea
                  id="chat-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  rows={3}
                  placeholder="Type your message..."
                  className="min-h-23 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-blue-500 transition focus:ring-2"
                />
                <button
                  type="submit"
                  disabled={!canSend}
                  className="h-11 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSending ? "Sending..." : "Send"}
                </button>
              </div>
            </form>
          </div>

          <aside className="border-t border-slate-200 bg-slate-50 p-4 text-sm md:border-l md:border-t-0">
            <h2 className="mb-3 text-base font-semibold text-slate-800">Session</h2>
            <dl className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">Status</dt>
                <dd className="mt-1 text-slate-700">{status}</dd>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">Conversation ID</dt>
                <dd className="mt-1 break-all font-mono text-xs text-slate-700">{conversationId || "creating..."}</dd>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">Messages</dt>
                <dd className="mt-1 text-slate-700">{messages.length}</dd>
              </div>
            </dl>
          </aside>
        </section>
      </main>
    </div>
  );
}
