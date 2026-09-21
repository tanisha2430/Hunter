import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  AIProvider,
  EmbedParams,
  GenerateStructuredParams,
  AiUsageRecord,
} from "../ai-provider";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const RETRYABLE_STATUS = new Set([429, 503]);

/**
 * The free tier intermittently returns 503 ("high demand") and 429 (rate
 * limit) — both are genuinely transient, not a request-shape problem, so a
 * short retry with backoff resolves most of them without bothering the caller.
 */
async function fetchWithRetry(url: string, init: RequestInit, maxAttempts = 6): Promise<Response> {
  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url, init);
    if (res.ok || !RETRYABLE_STATUS.has(res.status)) return res;
    lastResponse = res;
    if (attempt < maxAttempts - 1) {
      const delayMs = Math.min(1000 * 2 ** attempt, 10_000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return lastResponse!;
}

/**
 * Recursively strips JSON-Schema keywords Gemini's `responseSchema` doesn't
 * accept (it only supports a constrained OpenAPI-3-like subset — no
 * `$schema`/`$ref`/`additionalProperties`/`default`/etc., and composition
 * keywords like `anyOf` are limited). Zod's `.optional()` fields already
 * come through fine (just omitted from `required`); this mainly guards
 * against stray metadata keys zod-to-json-schema emits.
 */
function sanitizeForGemini(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(sanitizeForGemini);
  }
  if (node && typeof node === "object") {
    const disallowedKeys = new Set([
      "$schema",
      "additionalProperties",
      "default",
      "definitions",
      "$ref",
      "const",
      "exclusiveMinimum",
      "exclusiveMaximum",
    ]);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (disallowedKeys.has(key)) continue;
      out[key] = sanitizeForGemini(value);
    }
    return out;
  }
  return node;
}

export class GoogleProvider implements AIProvider {
  readonly name = "GOOGLE" as const;

  constructor(private apiKey: string) {}

  async generateStructured<T>(params: GenerateStructuredParams<T>, model: string) {
    // A malformed/degenerate generation (invalid JSON, or valid JSON that
    // fails schema validation) is rare but has been observed on the free
    // tier — worth one retry before surfacing the error, since a fresh
    // sample often succeeds cleanly.
    try {
      return await this.attemptGenerateStructured(params, model);
    } catch (error) {
      const isOutputIssue =
        error instanceof Error &&
        (error.message.includes("was not valid JSON") || error.message.includes("failed schema validation"));
      if (!isOutputIssue) throw error;
      return this.attemptGenerateStructured(params, model);
    }
  }

  private async attemptGenerateStructured<T>(params: GenerateStructuredParams<T>, model: string) {
    const rawSchema = zodToJsonSchema(params.schema, {
      name: "schema",
      target: "openApi3",
      $refStrategy: "none",
    });
    const schemaBody = (rawSchema as { definitions?: Record<string, unknown> }).definitions?.schema
      ?? rawSchema;
    const responseSchema = sanitizeForGemini(schemaBody);

    const contextBlock = params.context
      ? `\n\n<context>\n${JSON.stringify(params.context, null, 2)}\n</context>`
      : "";

    const start = Date.now();
    const res = await fetchWithRetry(
      `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: params.system }] },
          contents: [{ role: "user", parts: [{ text: `${params.prompt}${contextBlock}` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema,
            maxOutputTokens: params.maxOutputTokens ?? 16384,
            // "Thinking" tokens count against maxOutputTokens. Verified
            // empirically on this exact schema+prompt: default (unbounded)
            // thinking ate the whole budget before any real output, leaving
            // required array fields empty; thinkingBudget: 0 avoided that but
            // occasionally caused a degenerate token-repetition loop (the
            // model got stuck repeating "2021\n" thousands of times in a date
            // field until truncation). A small non-zero budget avoided both
            // failure modes and produced a complete, correct extraction.
            thinkingConfig: { thinkingBudget: 1024 },
          },
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`Gemini request failed (${res.status}): ${await res.text()}`);
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text: string | undefined = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error(`Gemini response had no text content: ${JSON.stringify(json)}`);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`Gemini response was not valid JSON: ${text}`);
    }

    const parsed = params.schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Gemini structured output failed schema validation: ${parsed.error.message}`);
    }

    const usage: AiUsageRecord = {
      provider: this.name,
      model,
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs: Date.now() - start,
    };

    return { data: parsed.data, usage };
  }

  async embed(params: EmbedParams, model: string) {
    const start = Date.now();
    const res = await fetchWithRetry(
      `${API_BASE}/models/${encodeURIComponent(model)}:batchEmbedContents?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: params.texts.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            // Matches the pgvector(1536) column on `jobs.descriptionEmbedding` —
            // gemini-embedding-001 natively outputs 3072 dims but supports MRL
            // truncation via this param.
            outputDimensionality: 1536,
          })),
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`Gemini embeddings request failed (${res.status}): ${await res.text()}`);
    }

    const json = (await res.json()) as { embeddings: Array<{ values: number[] }> };
    const vectors: number[][] = json.embeddings.map((e) => e.values);

    const usage: AiUsageRecord = {
      provider: this.name,
      model,
      inputTokens: 0, // Gemini's embedContent response doesn't report token usage
      outputTokens: 0,
      latencyMs: Date.now() - start,
    };

    return { vectors, usage };
  }
}
