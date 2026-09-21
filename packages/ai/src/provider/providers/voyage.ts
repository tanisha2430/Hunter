import type { AIProvider, EmbedParams, GenerateStructuredParams, AiUsageRecord } from "../ai-provider";
import { UnsupportedOperationError } from "../ai-provider";

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
  usage: { total_tokens: number };
}

/**
 * Embeddings-only provider (Voyage AI, Anthropic's recommended embeddings
 * partner). Anthropic has no native embeddings endpoint — see
 * providers/anthropic.ts `embed()`.
 */
export class VoyageProvider implements AIProvider {
  readonly name = "VOYAGE" as const;

  constructor(private apiKey: string) {}

  async generateStructured<T>(_params: GenerateStructuredParams<T>, _model: string): Promise<never> {
    throw new UnsupportedOperationError(this.name, "structured text generation");
  }

  async embed(params: EmbedParams, model: string) {
    const start = Date.now();
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: params.texts, model }),
    });

    if (!res.ok) {
      throw new Error(`Voyage embeddings request failed: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as VoyageEmbeddingResponse;
    const usage: AiUsageRecord = {
      provider: this.name,
      model,
      inputTokens: json.usage.total_tokens,
      outputTokens: 0,
      latencyMs: Date.now() - start,
    };

    return { vectors: json.data.map((d) => d.embedding), usage };
  }
}
