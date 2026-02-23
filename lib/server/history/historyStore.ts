export type ConversationPart = {
  text?: string;
  functionCall?: {
    name: string;
    args?: Record<string, unknown>;
    thought_signature?: string;
    thoughtSignature?: string;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
  thought_signature?: string;
};

export type ConversationRole = "user" | "assistant" | "model" | "tool";

export type ConversationTurn = {
  role: ConversationRole;
  parts: ConversationPart[];
};

const MAX_HISTORY_MESSAGES = 20;
const conversationStore = new Map<string, ConversationTurn[]>();

function trimHistory(history: ConversationTurn[]): ConversationTurn[] {
  if (history.length <= MAX_HISTORY_MESSAGES) {
    return history;
  }
  return history.slice(history.length - MAX_HISTORY_MESSAGES);
}

export function getConversationHistory(conversationId: string): ConversationTurn[] {
  return [...(conversationStore.get(conversationId) ?? [])];
}

export function setConversationHistory(
  conversationId: string,
  turns: ConversationTurn[],
): ConversationTurn[] {
  const next = trimHistory([...turns]);
  conversationStore.set(conversationId, next);
  return [...next];
}

export function clearConversationHistory(conversationId: string): boolean {
  return conversationStore.delete(conversationId);
}
