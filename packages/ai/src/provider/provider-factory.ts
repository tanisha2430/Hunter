import type { AIProvider, AIProviderName } from "./ai-provider";
import { AnthropicProvider } from "./providers/anthropic";
import { VoyageProvider } from "./providers/voyage";
import { GoogleProvider } from "./providers/google";

export interface ProviderFactoryConfig {
  anthropicApiKey: string;
  voyageApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
}

/**
 * Builds the AIProvider instance for a given provider name. Called by
 * agents/services with `resolveModelConfig(...).provider` — no call site
 * elsewhere branches on provider name directly.
 */
export function createProvider(name: AIProviderName, config: ProviderFactoryConfig): AIProvider {
  switch (name) {
    case "ANTHROPIC":
      return new AnthropicProvider(config.anthropicApiKey);
    case "VOYAGE":
      if (!config.voyageApiKey) {
        throw new Error("VOYAGE_API_KEY is not configured but the embedding task requires it.");
      }
      return new VoyageProvider(config.voyageApiKey);
    case "OPENAI":
      throw new Error("OpenAIProvider is not yet implemented — configure ANTHROPIC/GOOGLE instead.");
    case "GOOGLE":
      if (!config.googleApiKey) {
        throw new Error("GOOGLE_AI_API_KEY is not configured but a task requires it.");
      }
      return new GoogleProvider(config.googleApiKey);
  }
}
