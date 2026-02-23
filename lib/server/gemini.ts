import type { ConversationTurn } from "@/lib/server/historyStore";
import { getGeminiModels } from "@/lib/server/modelConfig";
const GEMINI_HOST = "https://generativelanguage.googleapis.com";
const DEFAULT_API_VERSIONS = ["v1", "v1beta"];

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
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

function extractTextFromResponse(data: GeminiResponse): string {
  const firstCandidate = data.candidates?.[0];
  const text = firstCandidate?.content?.parts
    ?.map((part) => part.text?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n")
    .trim();

  if (!text) {
    throw new GeminiError("Gemini returned an empty response.", 502, false);
  }

  return text;
}

async function callGeminiModel(
  model: string,
  apiKey: string,
  contents: ConversationTurn[],
): Promise<string> {
  const cleanModel = normalizeModelName(model);
  const versions = getApiVersions();
  let lastError: GeminiError | null = null;

  for (const version of versions) {
    const url = buildGenerateContentUrl(version, cleanModel, apiKey);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ contents }),
    });

    const data = (await response.json().catch(() => ({}))) as GeminiResponse;
    if (response.ok) {
      return extractTextFromResponse(data);
    }

    const upstreamMessage = data.error?.message || "Gemini request failed.";
    const error = new GeminiError(upstreamMessage, response.status, isRetryableStatus(response.status));
    lastError = error;

    if (response.status !== 404) {
      throw error;
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
      discovered.add(normalizeModelName(name));
    }
  }

  return [...discovered];
}

export async function generateReplyWithFallback(
  contents: ConversationTurn[],
): Promise<{ reply: string; model: string; attemptedModels: string[] }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiConfigError("GEMINI_API_KEY is not configured.");
  }

  const models = getGeminiModels();
  const attemptedModels: string[] = [];
  let lastError: GeminiError | null = null;
  const tried = new Set<string>();

  for (const model of models) {
    const cleanModel = normalizeModelName(model);
    if (!cleanModel || tried.has(cleanModel)) {
      continue;
    }

    attemptedModels.push(cleanModel);
    tried.add(cleanModel);
    try {
      const reply = await callGeminiModel(cleanModel, apiKey, contents);
      return { reply, model: cleanModel, attemptedModels };
    } catch (error) {
      if (!(error instanceof GeminiError)) {
        throw error;
      }

      lastError = error;
      if (!canTryFallback(error.status) || model === models[models.length - 1]) {
        break;
      }
    }
  }

  if (lastError?.status === 404) {
    const discoveredModels = await listGenerateContentModels(apiKey);
    for (const model of discoveredModels) {
      if (tried.has(model)) {
        continue;
      }
      attemptedModels.push(model);
      tried.add(model);

      try {
        const reply = await callGeminiModel(model, apiKey, contents);
        return { reply, model, attemptedModels };
      } catch (error) {
        if (!(error instanceof GeminiError)) {
          throw error;
        }
        lastError = error;
        if (!canTryFallback(error.status)) {
          break;
        }
      }
    }
  }

  throw (
    lastError ??
    new GeminiError("No Gemini model could generate a response.", 502, false)
  );
}
