import type { ConversationTurn } from "@/lib/server/history/historyStore";

import { getGeminiModels } from "@/lib/server/config/modelConfig";
import { callGemini } from "@/lib/server/gemini/client";
import { runWithModelFallback } from "@/lib/server/gemini/fallback";
import { executeTool } from "@/lib/tools/executeTool";
import { getToolDeclarations } from "@/lib/tools/registry";

export async function generateGeminiReply(
  conversation: ConversationTurn[],
  systemPrompt?: string,
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
        systemPrompt,
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
