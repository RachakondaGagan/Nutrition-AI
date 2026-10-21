import { configFromEnv, createGrokNutritionService, type AnalysisResult } from "./grokNutritionService.js";
import { mockProvider } from "./mockProvider.js";

export interface NutritionProvider {
  name: "groq" | "grok" | "mock";
  analyzeText(description: string, mealHint?: string): Promise<AnalysisResult>;
  analyzeImage(bytes: Buffer, mime: "image/jpeg" | "image/png", note?: string): Promise<AnalysisResult>;
  chat?(messages: Array<{ role: string; content: string }>): Promise<string>;
}

/** Real Grok / Groq when XAI_* variables are set, otherwise the clearly labelled mock. */
export function createProvider(env: NodeJS.ProcessEnv): NutritionProvider {
  if (env.XAI_API_KEY && env.XAI_TEXT_MODEL && env.XAI_VISION_MODEL) {
    const isGroq = env.XAI_API_KEY.startsWith("gsk_") || (env.XAI_BASE_URL ?? "").includes("groq.com");
    return { name: isGroq ? "groq" : "grok", ...createGrokNutritionService(configFromEnv(env)) };
  }
  return mockProvider;
}
