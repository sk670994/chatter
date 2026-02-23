export const DEFAULT_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash"];

export function getGeminiModels(): string[] {
  const raw = process.env.GEMINI_MODELS?.trim();
  if (!raw) {
    return DEFAULT_MODELS;
  }

  const models = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return models.length > 0 ? models : DEFAULT_MODELS;
}
