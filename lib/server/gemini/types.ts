import type { ToolDeclaration } from "@/lib/tools/types";

import type { ConversationTurn } from "@/lib/server/history/historyStore";

export type ToolInvocation = {
  name: string;
  args: Record<string, unknown>;
  thought_signature?: string;
};

export type ModelResult = {
  text: string;
  functionCalls: ToolInvocation[];
};

export type GeminiRequestParams = {
  model: string;
  apiKey: string;
  conversation: ConversationTurn[];
  systemPrompt?: string;
  toolDeclarations: ToolDeclaration[];
};
