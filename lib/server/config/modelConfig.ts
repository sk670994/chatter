export const DEFAULT_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];

export function getGeminiModels(): string[] {
  const raw = (process.env.GEMINI_MODELS ?? process.env.GEMINI_MODEL)?.trim();
  if (!raw) {
    return DEFAULT_MODELS;
  }

  const models = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return models.length > 0 ? models : DEFAULT_MODELS;
}

function isLikelyToolCapableModel(model: string): boolean {
  const name = model.toLowerCase();

  if (name.includes("gemma")) {
    return false;
  }
  if (name.includes("tts")) {
    return false;
  }
  if (name.includes("image-generation")) {
    return false;
  }

  return true;
}

export function getGeminiToolModels(): string[] {
  const models = getGeminiModels();
  const filtered = models.filter(isLikelyToolCapableModel);
  return filtered.length > 0 ? filtered : DEFAULT_MODELS;
}
