import type { ConversationPart, ConversationTurn } from "@/lib/server/historyStore";
import { getGeminiModels } from "@/lib/server/modelConfig";
import type { ToolDeclaration } from "@/lib/tools/types";

const GEMINI_HOST = "https://generativelanguage.googleapis.com";
const DEFAULT_API_VERSIONS = ["v1", "v1beta"];
const TOOL_LOOP_LIMIT = 6;

type GeminiApiTool = {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: {
          name?: string;
          args?: Record<string, unknown>;
        };
      }>;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type GeminiListModelsResponse = {
  models?: Array<{
    name?: string;
    supportedGenerationMethods?: string[];
  }>;
};

type ToolInvocation = {
  name: string;
  args: Record<string, unknown>;
};

type ModelCallResult = {
  modelTurn: ConversationTurn;
  replyText: string;
  functionCalls: ToolInvocation[];
};

export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export type GenerateReplyOptions = {
  tools?: ToolDeclaration[];
  executeTool?: ToolExecutor;
};

export type GenerateReplyResult = {
  reply: string;
  model: string;
  attemptedModels: string[];
  contents: ConversationTurn[];
  toolCallsUsed: number;
  toolNamesUsed: string[];
};

export class GeminiError extends Error {
  status: number;
  retryable: boolean;

  constructor(message: string, status: number, retryable = false) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
    this.retryable = retryable;
  }
}

export class GeminiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiConfigError";
  }
}

function isRetryableStatus(status: number): boolean {
  return [429, 500, 502, 503, 504].includes(status);
}

function canTryFallback(status: number): boolean {
  return status === 404 || isRetryableStatus(status);
}

function shouldTryNextModel(error: GeminiError): boolean {
  if (canTryFallback(error.status)) {
    return true;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("multiturn chat is not enabled") ||
    message.includes("unknown name \"tools\"") ||
    message.includes("unsupported") ||
    message.includes("not found for api version")
  );
}

function isToolSchemaUnsupportedError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('unknown name "tools"') || normalized.includes('unknown name "functiondeclarations"');
}

function getApiVersions(): string[] {
  const raw = process.env.GEMINI_API_VERSIONS?.trim();
  if (!raw) {
    return DEFAULT_API_VERSIONS;
  }

  const versions = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return versions.length > 0 ? versions : DEFAULT_API_VERSIONS;
}

function normalizeModelName(model: string): string {
  return model.replace(/^models\//, "").trim();
}

function buildGenerateContentUrl(version: string, model: string, apiKey: string): string {
  return `${GEMINI_HOST}/${version}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

function toGeminiTools(tools: ToolDeclaration[]): GeminiApiTool[] | undefined {
  if (!tools.length) {
    return undefined;
  }

  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    },
  ];
}

function extractModelResult(data: GeminiResponse): ModelCallResult {
  const firstCandidate = data.candidates?.[0];
  const parts = firstCandidate?.content?.parts ?? [];

  const normalizedParts: ConversationPart[] = [];
  const textParts: string[] = [];
  const functionCalls: ToolInvocation[] = [];

  for (const part of parts) {
    if (typeof part.text === "string" && part.text.trim().length > 0) {
      const text = part.text.trim();
      normalizedParts.push({ text });
      textParts.push(text);
    }

    const functionCall = part.functionCall;
    if (functionCall?.name) {
      const name = functionCall.name.trim();
      const args = functionCall.args ?? {};
      normalizedParts.push({
        functionCall: {
          name,
          args,
        },
      });
      functionCalls.push({ name, args });
    }
  }

  if (!normalizedParts.length) {
    throw new GeminiError("Gemini returned an empty response.", 502, false);
  }

  return {
    modelTurn: {
      role: "model",
      parts: normalizedParts,
    },
    replyText: textParts.join("\n").trim(),
    functionCalls,
  };
}

async function callGeminiModel(
  model: string,
  apiKey: string,
  contents: ConversationTurn[],
  tools: ToolDeclaration[],
): Promise<ModelCallResult> {
  const cleanModel = normalizeModelName(model);
  const versions = getApiVersions();
  let lastError: GeminiError | null = null;
  const payloadVariants: Array<{ includeTools: boolean }> = tools.length
    ? [{ includeTools: true }, { includeTools: false }]
    : [{ includeTools: false }];

  for (const payloadVariant of payloadVariants) {
    const geminiTools = payloadVariant.includeTools ? toGeminiTools(tools) : undefined;

    for (const version of versions) {
      const url = buildGenerateContentUrl(version, cleanModel, apiKey);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents,
          tools: geminiTools,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as GeminiResponse;
      if (response.ok) {
        return extractModelResult(data);
      }

      const upstreamMessage = data.error?.message || "Gemini request failed.";
      const error = new GeminiError(upstreamMessage, response.status, isRetryableStatus(response.status));
      lastError = error;

      if (
        payloadVariant.includeTools &&
        response.status === 400 &&
        isToolSchemaUnsupportedError(upstreamMessage)
      ) {
        break;
      }

      if (response.status !== 404) {
        throw error;
      }
    }
  }

  throw lastError ?? new GeminiError("Gemini model call failed.", 502, false);
}

async function listGenerateContentModels(apiKey: string): Promise<string[]> {
  const versions = getApiVersions();
  const discovered = new Set<string>();

  for (const version of versions) {
    const url = `${GEMINI_HOST}/${version}/models?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);
    if (!response.ok) {
      continue;
    }

    const data = (await response.json().catch(() => ({}))) as GeminiListModelsResponse;
    for (const model of data.models ?? []) {
      const name = model.name?.trim();
      if (!name) {
        continue;
      }
      const supportsGenerateContent = (model.supportedGenerationMethods ?? []).includes(
        "generateContent",
      );
      if (!supportsGenerateContent) {
        continue;
      }
      const normalizedName = normalizeModelName(name);
      if (normalizedName.toLowerCase().includes("tts")) {
        continue;
      }
      discovered.add(normalizedName);
    }
  }

  return [...discovered];
}

async function callWithModelFallback(
  apiKey: string,
  contents: ConversationTurn[],
  tools: ToolDeclaration[],
  preferredModel: string | null,
  attemptedModels: string[],
): Promise<{ result: ModelCallResult; model: string }> {
  const configuredModels = getGeminiModels();
  const orderedModels = preferredModel
    ? [preferredModel, ...configuredModels.filter((item) => normalizeModelName(item) !== preferredModel)]
    : configuredModels;
  const tried = new Set<string>();
  let lastError: GeminiError | null = null;

  for (const model of orderedModels) {
    const cleanModel = normalizeModelName(model);
    if (!cleanModel || tried.has(cleanModel)) {
      continue;
    }
    tried.add(cleanModel);
    if (!attemptedModels.includes(cleanModel)) {
      attemptedModels.push(cleanModel);
    }

    try {
      const result = await callGeminiModel(cleanModel, apiKey, contents, tools);
      return { result, model: cleanModel };
    } catch (error) {
      if (!(error instanceof GeminiError)) {
        throw error;
      }
      lastError = error;
      if (!shouldTryNextModel(error)) {
        throw error;
      }
    }
  }

  if (lastError?.status === 404) {
    const discoveredModels = await listGenerateContentModels(apiKey);
    for (const model of discoveredModels) {
      if (tried.has(model)) {
        continue;
      }
      tried.add(model);
      if (!attemptedModels.includes(model)) {
        attemptedModels.push(model);
      }

      try {
        const result = await callGeminiModel(model, apiKey, contents, tools);
        return { result, model };
      } catch (error) {
        if (!(error instanceof GeminiError)) {
          throw error;
        }
        lastError = error;
        if (!shouldTryNextModel(error)) {
          throw error;
        }
      }
    }
  }

  throw (
    lastError ??
    new GeminiError("No Gemini model could generate a response.", 502, false)
  );
}

function buildFunctionResponseTurn(name: string, response: Record<string, unknown>): ConversationTurn {
  return {
    role: "user",
    parts: [
      {
        functionResponse: {
          name,
          response,
        },
      },
    ],
  };
}

export async function generateReplyWithFallback(
  contents: ConversationTurn[],
  options: GenerateReplyOptions = {},
): Promise<GenerateReplyResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiConfigError("GEMINI_API_KEY is not configured.");
  }

  const tools = options.tools ?? [];
  const executeTool = options.executeTool;
  const attemptedModels: string[] = [];
  const conversation = [...contents];
  let selectedModel: string | null = null;
  let finalReply = "";
  let toolCallsUsed = 0;
  const toolNamesUsed = new Set<string>();

  for (let iteration = 0; iteration < TOOL_LOOP_LIMIT; iteration += 1) {
    const modelCall = await callWithModelFallback(
      apiKey,
      conversation,
      tools,
      selectedModel,
      attemptedModels,
    );

    selectedModel = modelCall.model;
    conversation.push(modelCall.result.modelTurn);

    if (!modelCall.result.functionCalls.length) {
      finalReply = modelCall.result.replyText;
      if (!finalReply) {
        throw new GeminiError("Gemini returned no final text after tool loop.", 502, false);
      }
      return {
        reply: finalReply,
        model: selectedModel,
        attemptedModels,
        contents: conversation,
        toolCallsUsed,
        toolNamesUsed: [...toolNamesUsed],
      };
    }

    if (!executeTool) {
      throw new GeminiError("Model requested a tool call but no tool executor is configured.", 500, false);
    }

    for (const functionCall of modelCall.result.functionCalls) {
      toolCallsUsed += 1;
      toolNamesUsed.add(functionCall.name);
      let toolResult: Record<string, unknown>;
      try {
        toolResult = await executeTool(functionCall.name, functionCall.args);
      } catch (error) {
        toolResult = {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown tool execution error.",
        };
      }

      conversation.push(
        buildFunctionResponseTurn(functionCall.name, {
          result: toolResult,
        }),
      );
    }
  }

  throw new GeminiError(
    `Tool call loop limit (${TOOL_LOOP_LIMIT}) reached before a final text response.`,
    502,
    false,
  );
}
