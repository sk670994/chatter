import { NextResponse } from "next/server";

import { generateGeminiReply } from "@/lib/server/gemini/generateReply";
import {
  ConversationTurn,
  getConversationHistory,
  setConversationHistory,
} from "@/lib/server/history/historyStore";

type ChatRequest = {
  conversationId?: string;
  message?: string;
};

export async function POST(request: Request) {
  let payload: ChatRequest;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = payload.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  const conversationId = payload.conversationId || crypto.randomUUID();
  const history = getConversationHistory(conversationId);

  const userTurn: ConversationTurn = {
    role: "user",
    parts: [{ text: message }],
  };

  const contents = [...history, userTurn];

  try {
    const rawReply = await generateGeminiReply(contents);
    const reply = rawReply.trim() || "I could not generate a response. Please try again.";

    const assistantTurn: ConversationTurn = {
      role: "assistant",
      parts: [{ text: reply }],
    };

    const updatedHistory = setConversationHistory(conversationId, [...contents, assistantTurn]);

    return NextResponse.json({
      reply,
      conversationId,
      history: updatedHistory,
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "LLM request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
