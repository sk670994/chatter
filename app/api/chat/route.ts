import { NextResponse } from "next/server";

type ChatRequest = {
  conversationId?: string;
  message?: string;
};

const MODEL = "gemini-2.0-flash";

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

  return NextResponse.json({
  
    conversationId,
    model: MODEL,
    history: [],
    toolCallsUsed: 0,
  });
}
