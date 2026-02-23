export async function runWithModelFallback<T>(
  models: string[],
  run: (model: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (const model of models) {
    try {
      return await run(model);
    } catch (error) {
      lastError = error;
      console.error(`Model failed: ${model}`, error);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All Gemini models failed");
}
