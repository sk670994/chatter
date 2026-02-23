import { NextResponse } from "next/server";
import { clearConversationHistory, getConversationHistory } from "@/lib/server/historyStore";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  if (!conversationId?.trim()) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  const history = getConversationHistory(conversationId.trim());
  return NextResponse.json({ conversationId, history });
}

export async function DELETE(_: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  if (!conversationId?.trim()) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  const removed = clearConversationHistory(conversationId.trim());
  return NextResponse.json({ conversationId, cleared: removed });
}
