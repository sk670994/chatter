import type { ConversationTurn } from "@/lib/server/history/historyStore";

import type { GeminiRequestParams, ModelResult, ToolInvocation } from "@/lib/server/gemini/types";

const GEMINI_HOST =
  "https://generativelanguage.googleapis.com/v1beta/models";

export async function callGemini({
  model,
  apiKey,
  conversation,
  systemPrompt,
  toolDeclarations,
}: GeminiRequestParams): Promise<ModelResult> {
  const body = {
    contents: buildGeminiContents(conversation),
    systemInstruction: systemPrompt
      ? {
          parts: [{ text: systemPrompt }],
        }
      : undefined,
    tools: [
      {
        functionDeclarations: toolDeclarations,
      },
    ],
  };

  const response = await fetch(
    `${GEMINI_HOST}/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  const json = await response.json();

  if (!response.ok) {
    const message =
      json?.error?.message ||
      `Gemini request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return extractModelResult(json);
}

function buildGeminiContents(turns: ConversationTurn[]) {
  return turns.map((turn) => ({
    role: mapRole(turn.role),
    parts: turn.parts.map((part) => {
      if (part.text) {
        return { text: part.text };
      }

      if (part.functionResponse) {
        return {
          functionResponse: {
            name: part.functionResponse.name,
            response: part.functionResponse.response,
          },
          ...(part.thought_signature && {
            thought_signature: part.thought_signature,
          }),
        };
      }

      return {};
    }),
  }));
}

function mapRole(role: ConversationTurn["role"]): string {
  if (role === "assistant") {
    return "model";
  }
  return role;
}

function extractModelResult(response: any): ModelResult {
  const candidate = response?.candidates?.[0];

  if (!candidate) {
    const blockedReason =
      response?.promptFeedback?.blockReason ||
      response?.prompt_feedback?.block_reason;
    if (blockedReason) {
      throw new Error(`Gemini blocked the prompt: ${blockedReason}`);
    }
    return { text: "", functionCalls: [] };
  }

  const parts = candidate.content?.parts ?? [];
  let text = "";
  const functionCalls: ToolInvocation[] = [];

  for (const part of parts) {
    if (part.text) {
      text += part.text;
    }

    if (part.functionCall) {
      functionCalls.push({
        name: part.functionCall.name,
        args: part.functionCall.args || {},
        thought_signature: part.thought_signature || part.thoughtSignature,
      });
    }
  }

  return { text, functionCalls };
}
