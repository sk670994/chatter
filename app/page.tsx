"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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

const DEFAULT_MODEL = "gemini-2.0-flash";
const CONVERSATION_KEY = "chatter:conversationId";

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

  const canSend = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || !conversationId || isSending) {
      return;
    }

    setIsSending(true);
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

  function resetConversation() {
    const newId = crypto.randomUUID();
    localStorage.setItem(CONVERSATION_KEY, newId);
    setConversationId(newId);
    setMessages([]);
    setStatus("Ready");
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#e9f5d7_0%,#f6f6f2_40%,#efe9d8_100%)] px-4 py-6 md:px-10 md:py-8">
      <main className="mx-auto flex h-[calc(100vh-3rem)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_16px_50px_rgba(20,83,45,0.12)]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface-strong)] px-5 py-4">
        
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full border border-[var(--line)] bg-white px-3 py-1 font-mono">{model}</span>
            <button
              type="button"
              onClick={resetConversation}
              className="rounded-full border border-[var(--line)] bg-white px-3 py-1 font-medium hover:bg-zinc-100"
            >
              New Chat
            </button>
          </div>
        </header>

        <section className="grid flex-1     gap-0 md:grid-cols-[1fr_280px]">
          <div className="flex min-h-0 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-6">
              {messages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--line)] bg-white/80 p-5">
                  <h2 className="text-lg font-semibold">Start a conversation</h2>
                  <p className="mt-2 text-sm text-zinc-600">Ask me anything or try out one of the tools I have access to!</p>
                </div>
              ) : null}

              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`max-w-full rounded-2xl border px-4 py-3 ${
                    message.role === "user"
                      ? "ml-auto border-red-700 bg-red-700 text-white"
                      : "border-blue-700 bg-blue-700 text-white"
                  }`}
                >
                  <p className="mb-1 font-mono text-xs uppercase tracking-wide opacity-80">{message.role}</p>
                  <p className="whitespace-pre-wrap text-sm leading-6">{message.text}</p>
                </article>
              ))}
            </div>

            <form onSubmit={sendMessage} className="border-t border-[var(--line)] bg-white p-4 md:p-5">
              <label htmlFor="chat-input" className="mb-2 block text-sm font-medium">
                Message
              </label>
              <div className="flex flex-col gap-3 md:flex-row">
                <textarea
                  id="chat-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  rows={3}
                  placeholder="Ask anything..."
                  className="min-h-[88px] w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2"
                />
                <button
                  type="submit"
                  disabled={!canSend}
                  className="h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSending ? "Sending..." : "Send"}
                </button>
              </div>
            </form>
          </div>
              
          <aside className="border-t border-[var(--line)] bg-[var(--surface-strong)] p-4 text-sm md:border-t-0 md:border-2">
            <h2 className="mb-3 font-semibold">Session</h2>
            <dl className="space-y-3">
              <div>
                <dt className="font-mono text-xs uppercase text-zinc-600">Status</dt>
                <dd className="mt-1">{status}</dd>
              </div>
              <div>
                <dt className="font-mono text-xs uppercase text-zinc-600">Conversation ID</dt>
                <dd className="mt-1 break-all font-mono text-xs">{conversationId || "creating..."}</dd>
              </div>
              <div>
                <dt className="font-mono text-xs uppercase text-zinc-600">Messages</dt>
                <dd className="m-1">{messages.length}</dd>
              </div>
            </dl>
          </aside>
        </section>
      </main>
    </div>
  );
}
