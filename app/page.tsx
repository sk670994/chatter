"use client";


import { FormEvent, UIEvent, useEffect, useMemo, useRef, useState } from "react";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
};

type ConversationTurn = {
  role: "user" | "model";
  parts: Array<{ text?: string }>;
};

type HistoryResponse = {
  conversationId: string;
  history: ConversationTurn[];
};

const CONVERSATION_KEY = "chatter:conversationId";
const AUTO_SCROLL_THRESHOLD = 80;
const API_BASE = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "");
const QUICK_PROMPTS = [
  "Give me today's top AI news in 5 bullets.",
  "What's the weather in New York right now?",
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

function apiUrl(path: string) {
  return API_BASE ? `${API_BASE}${path}` : path;
}

export default function Home() {
  const [conversationId, setConversationId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  function mapHistoryToMessages(history: ConversationTurn[]): ChatMessage[] {
    return history
      .map((turn, index) => {
        const text = turn.parts
          .map((part) => part.text ?? "")
          .join("\n")
          .trim();
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
        const response = await fetch(apiUrl(`/api/history/${encodeURIComponent(conversationId)}`));
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
    if (!trimmed || isSending) {
      return;
    }

    const assistantId = crypto.randomUUID();

    setIsSending(true);
    setAutoScrollEnabled(true);
    setStatus("Streaming reply...");
    setInput("");
    setMessages((current) => [
      ...current,
      createMessage("user", trimmed),
      {
        id: assistantId,
        role: "assistant",
        text: "",
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      await new Promise<void>((resolve, reject) => {
        const url = apiUrl(`/api/chat/stream?prompt=${encodeURIComponent(trimmed)}`);
        const source = new EventSource(url);
        let settled = false;

        const finish = () => {
          if (!settled) {
            settled = true;
            source.close();
          }
        };

        source.addEventListener("ready", () => {
          setStatus("Streaming reply...");
        });

        source.addEventListener("token", (event) => {
          const payload = JSON.parse((event as MessageEvent<string>).data) as { token?: string };
          if (!payload.token) {
            return;
          }

          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, text: `${message.text}${payload.token}` }
                : message
            )
          );
        });

        source.addEventListener("done", () => {
          finish();
          resolve();
        });

        source.onerror = () => {
          if (settled) {
            return;
          }
          finish();
          reject(new Error("SSE connection failed."));
        };
      });

      setStatus("Ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected chat error";
      setMessages((current) =>
        current.map((chatMessage) =>
          chatMessage.id === assistantId
            ? {
                ...chatMessage,
                text: chatMessage.text || `I could not complete the request. ${message}`,
              }
            : chatMessage
        )
      );
      setStatus("Request failed");
    } finally {
      setIsSending(false);
    }
  }

  async function resetConversation() {
    if (conversationId) {
      try {
        await fetch(apiUrl(`/api/history/${encodeURIComponent(conversationId)}`), {
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
    <div className="min-h-screen bg-[#f7f7f8] px-3 py-3 md:px-6 md:py-5">
      <main className="mx-auto flex h-[calc(100vh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 md:px-6">
          <div>
            <h1 className="text-sm font-semibold text-slate-800 md:text-base">Chatter</h1>
          </div>
          <button
            type="button"
            onClick={resetConversation}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            New chat
          </button>
        </header>

        <section className="min-h-0 flex-1">
          {messages.length === 0 ? (
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 md:px-6">
              <div className="flex flex-wrap gap-2">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setInput(prompt)}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="relative min-h-0 h-full">
            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              className="chat-scroll h-full min-h-0 space-y-3 overflow-y-scroll scroll-smooth overscroll-contain px-4 py-4 md:px-6"
            >
              {messages.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
                  Ask anything to start your conversation.
                </div>
              ) : null}

              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`message-fade max-w-[88%] rounded-2xl px-4 py-3 ${
                    message.role === "user"
                      ? "ml-auto bg-[#e9f2ff] text-slate-900"
                      : "mr-auto bg-[#f3f4f6] text-slate-900"
                  }`}
                >
                  <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-500">{message.role}</p>
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
                className="absolute bottom-4 right-6 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Latest
              </button>
            ) : null}
          </div>
        </section>

        <form onSubmit={sendMessage} className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 md:px-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end">
            <textarea
              id="chat-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={3}
              placeholder="Message Chatter..."
              className="min-h-[80px] w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-slate-400 focus:ring-2"
            />
            <button
              type="submit"
              disabled={!canSend}
              className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSending ? "Sending..." : "Send"}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">{status}</p>
        </form>
      </main>
    </div>
  );
}

