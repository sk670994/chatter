import { NextResponse } from "next/server";
import { generateReplyWithFallback, GeminiConfigError, GeminiError } from "@/lib/server/gemini";
import {
  appendConversationTurns,
  getConversationHistory,
  type ConversationTurn,
} from "@/lib/server/historyStore";

type ChatRequest = {
  conversationId?: string;
  message?: string;
};

export async function GET() {
  return NextResponse.json(
    {
      message: "Use POST /api/chat with JSON body: { conversationId?: string, message: string }",
    },
    { status: 200 },
  );
}

export async function POST(request: Request) {
  let payload: ChatRequest;

  try {
    payload = (await request.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = payload.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const conversationId = payload.conversationId?.trim() || crypto.randomUUID();
  const priorHistory = getConversationHistory(conversationId);
  const userTurn: ConversationTurn = { role: "user", parts: [{ text: message }] };
  const contents = [...priorHistory, userTurn];

  try {
    const llmResult = await generateReplyWithFallback(contents);
    const modelTurn: ConversationTurn = { role: "model", parts: [{ text: llmResult.reply }] };
    const updatedHistory = appendConversationTurns(conversationId, [userTurn, modelTurn]);

    return NextResponse.json({
      reply: llmResult.reply,
      conversationId,
      model: llmResult.model,
      history: updatedHistory,
      toolCallsUsed: 0,
      attemptedModels: llmResult.attemptedModels,
    });
  } catch (error) {
    if (error instanceof GeminiConfigError) {
      return NextResponse.json(
        { error: "Server is missing LLM configuration. Add GEMINI_API_KEY." },
        { status: 500 },
      );
    }

    if (error instanceof GeminiError) {
      const status = error.status >= 400 ? error.status : 502;
      return NextResponse.json(
        {
          error:
            status >= 500
              ? "Upstream LLM request failed. Try again in a moment."
              : error.message,
        },
        { status },
      );
    }

    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
