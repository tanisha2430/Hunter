import type { z } from "zod";

export type AIProviderName = "ANTHROPIC" | "OPENAI" | "GOOGLE" | "VOYAGE";

export type AITaskType =
  | "JOB_MATCH_SCORING"
  | "JOB_EXTRACTION"
  | "RESUME_PARSING"
  | "RESUME_TAILORING"
  | "COVER_LETTER"
  | "EMBEDDING"
  | "OUTREACH_MESSAGE"
  | "COMMAND_PARSE"
  | "COMPANY_RESEARCH"
  | "EMAIL_CLASSIFICATION"
  | "GENERAL";

export interface AiUsageRecord {
  provider: AIProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  latencyMs: number;
}

export interface EntityRef {
  type: string;
  id: string;
}

export interface GenerateStructuredParams<T> {
  // Input param loosened to `any` so T binds to the schema's Output type only
  // (Zod schemas with `.default()` have Input != Output; without this, TS
  // generic inference can bind T to the more-permissive Input type instead).
  schema: z.ZodType<T, z.ZodTypeDef, any>;
  system: string;
  prompt: string;
  context?: Record<string, unknown>;
  taskType: AITaskType;
  agent: string;
  entityRef?: EntityRef;
  userId?: string;
  maxOutputTokens?: number;
}

export interface EmbedParams {
  texts: string[];
  taskType: AITaskType;
  userId?: string;
}

/**
 * Provider-agnostic AI abstraction. Every generative call in the system goes
 * through `generateStructured` — free-text-then-manually-parsed output is
 * intentionally not exposed, so every AI call is schema-validated by
 * construction. Implementations: providers/anthropic.ts (default),
 * providers/openai.ts, providers/google.ts.
 */
export interface AIProvider {
  readonly name: AIProviderName;

  generateStructured<T>(
    params: GenerateStructuredParams<T>,
    model: string,
  ): Promise<{ data: T; usage: AiUsageRecord }>;

  embed(params: EmbedParams, model: string): Promise<{ vectors: number[][]; usage: AiUsageRecord }>;
}

export class UnsupportedOperationError extends Error {
  constructor(provider: AIProviderName, operation: string) {
    super(`${provider} does not support ${operation}.`);
    this.name = "UnsupportedOperationError";
  }
}
