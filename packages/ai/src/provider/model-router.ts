import type { AITaskType, AIProviderName } from "./ai-provider";

export interface TaskModelConfig {
  provider: AIProviderName;
  model: string;
}

/**
 * Task-tiered default model selection. Cheap/fast models for high-volume,
 * low-ambiguity work; the stronger model only for judgment-heavy generation.
 * Overridable per-user via Settings.aiProviderOverrides (merged in
 * `resolveModelConfig`).
 */
// Defaults currently point at Gemini's free tier (no billing required) per
// user preference — swap back to ANTHROPIC/VOYAGE entries (kept below in
// MODEL_PRICING_USD_PER_MTOK) once Anthropic credits are added, or override
// per-user via Settings.aiProviderOverrides without a code change.
//
// IMPORTANT: as verified live against this project's key, the free tier has
// a ZERO request quota for "pro"-tier Gemini models (confirmed via a 429
// RESOURCE_EXHAUSTED with `limit: 0` for gemini-3.1-pro) — only "flash" tier
// models are actually usable without billing. `gemini-flash-latest`/
// `gemini-embedding-001` are rolling aliases (resolved to gemini-3.8-flash
// at the time this was verified) rather than a pinned version, so this
// doesn't need updating every time Google ships a new default model.
export const DEFAULT_TASK_MODEL_CONFIG: Record<AITaskType, TaskModelConfig> = {
  JOB_MATCH_SCORING: { provider: "GOOGLE", model: "gemini-flash-latest" },
  JOB_EXTRACTION: { provider: "GOOGLE", model: "gemini-flash-latest" },
  RESUME_PARSING: { provider: "GOOGLE", model: "gemini-flash-latest" },
  RESUME_TAILORING: { provider: "GOOGLE", model: "gemini-flash-latest" },
  COVER_LETTER: { provider: "GOOGLE", model: "gemini-flash-latest" },
  OUTREACH_MESSAGE: { provider: "GOOGLE", model: "gemini-flash-latest" },
  COMMAND_PARSE: { provider: "GOOGLE", model: "gemini-flash-latest" },
  COMPANY_RESEARCH: { provider: "GOOGLE", model: "gemini-flash-latest" },
  EMAIL_CLASSIFICATION: { provider: "GOOGLE", model: "gemini-flash-latest" },
  GENERAL: { provider: "GOOGLE", model: "gemini-flash-latest" },
  EMBEDDING: { provider: "GOOGLE", model: "gemini-embedding-001" },
};

/** Per-model $/MTok pricing, used by the usage logger to compute costUsd at call time. */
export const MODEL_PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "voyage-3": { input: 0.06, output: 0 },
  // Gemini free-tier usage is $0 unless/until billing is enabled on the project.
  "gemini-flash-latest": { input: 0, output: 0 },
  "gemini-pro-latest": { input: 0, output: 0 },
  "gemini-embedding-001": { input: 0, output: 0 },
};

export type AiProviderOverrides = Partial<Record<AITaskType, Partial<TaskModelConfig>>>;

export function resolveModelConfig(
  taskType: AITaskType,
  userOverrides?: AiProviderOverrides | null,
): TaskModelConfig {
  const base = DEFAULT_TASK_MODEL_CONFIG[taskType];
  const override = userOverrides?.[taskType];
  return override ? { ...base, ...override } : base;
}

export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING_USD_PER_MTOK[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}
