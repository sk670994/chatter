import type { ConversationTurn } from "@/lib/server/history/historyStore";

import { getGeminiModels } from "@/lib/server/config/modelConfig";
import { callGemini } from "@/lib/server/gemini/client";
import { runWithModelFallback } from "@/lib/server/gemini/fallback";
import { executeTool } from "@/lib/tools/executeTool";
import { getToolDeclarations } from "@/lib/tools/registry";

const SYSTEM_PROMPT =
  "You are Chatter, a reliable and concise AI assistant. Core behavior: Give clear, direct, and helpful answers. Keep responses short by default; add detail only when asked. If user asks in Hinglish/Hindi, reply in same style. If unclear, ask one precise follow-up question. Safety and accuracy: Do not provide harmful, illegal, or unsafe instructions. Do not invent facts; if unsure, say so clearly. Do not claim actions you cannot perform. Tool usage policy: Use tools only when needed for factual/real-time data. If a tool fails, say it and provide fallback. Do not expose internal tool-call details unless asked. Formatting: Prefer plain readable text, use bullets for lists, avoid unnecessary verbosity.";

export async function generateGeminiReply(
  conversation: ConversationTurn[],
): Promise<string> {
  const models = getGeminiModels();
  const toolDeclarations = getToolDeclarations();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set.");
  }

  return runWithModelFallback(models, async (model) => {
    const session = [...conversation];

    while (true) {
      const result = await callGemini({
        model,
        apiKey,
        conversation: session,
        systemPrompt: SYSTEM_PROMPT,
        toolDeclarations,
      });

      if (result.functionCalls.length === 0) {
        const text = result.text.trim();
        return text || "I could not generate a response. Please try again.";
      }

      for (const call of result.functionCalls) {
        const toolResult = await executeTool(call.name, call.args);
        session.push(buildFunctionResponseTurn(call.name, toolResult, call.thought_signature));
      }
    }
  });
}

function buildFunctionResponseTurn(
  name: string,
  result: Record<string, unknown>,
  thoughtSignature?: string,
): ConversationTurn {
  return {
    role: "tool",
    parts: [
      {
        functionResponse: {
          name,
          response: result,
        },
        ...(thoughtSignature && {
          thought_signature: thoughtSignature,
        }),
      },
    ],
  };
}
