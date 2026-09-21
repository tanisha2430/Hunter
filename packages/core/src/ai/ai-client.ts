import type { z } from "zod";
import { prisma, Prisma } from "@hunter/db";
import {
  createProvider,
  resolveModelConfig,
  computeCostUsd,
  type AITaskType,
  type EntityRef,
  type AiProviderOverrides,
} from "@hunter/ai";

/**
 * The only entry point `packages/core` uses to call into `packages/ai`.
 * Wraps AIProvider.generateStructured with DB-backed observability
 * (ai_runs/ai_usage) — kept here rather than inside packages/ai so that
 * package stays free of Prisma/DB coupling per the architecture's
 * dependency direction (packages/ai is pure; packages/core owns state).
 */
export interface LoggedGenerateParams<T> {
  schema: z.ZodType<T, z.ZodTypeDef, any>;
  system: string;
  prompt: string;
  context?: Record<string, unknown>;
  taskType: AITaskType;
  agent: string;
  entityRef?: EntityRef;
  userId?: string;
  maxOutputTokens?: number;
  userAiOverrides?: AiProviderOverrides | null;
}

function getProviderConfig() {
  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    voyageApiKey: process.env.VOYAGE_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    googleApiKey: process.env.GOOGLE_AI_API_KEY,
  };
}

export interface GenerateStructuredResult<T> {
  data: T;
  model: string;
  provider: string;
}

export async function generateStructured<T>(
  params: LoggedGenerateParams<T>,
): Promise<GenerateStructuredResult<T>> {
  const { provider: providerName, model } = resolveModelConfig(params.taskType, params.userAiOverrides);
  const provider = createProvider(providerName, getProviderConfig());

  const aiRun = await prisma.aIRun.create({
    data: {
      userId: params.userId,
      taskType: params.taskType,
      agent: params.agent,
      provider: providerName,
      model,
      input: { prompt: params.prompt, context: params.context ?? {} } as Prisma.InputJsonValue,
      status: "pending",
      linkedEntityType: params.entityRef?.type,
      linkedEntityId: params.entityRef?.id,
    },
  });

  const start = Date.now();
  try {
    const { data, usage } = await provider.generateStructured(
      {
        schema: params.schema,
        system: params.system,
        prompt: params.prompt,
        context: params.context,
        taskType: params.taskType,
        agent: params.agent,
        entityRef: params.entityRef,
        userId: params.userId,
        maxOutputTokens: params.maxOutputTokens,
      },
      model,
    );

    await prisma.aIRun.update({
      where: { id: aiRun.id },
      data: {
        status: "success",
        output: data as object,
        latencyMs: Date.now() - start,
      },
    });

    await prisma.aIUsage.create({
      data: {
        aiRunId: aiRun.id,
        userId: params.userId,
        provider: providerName,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
        costUsd: computeCostUsd(model, usage.inputTokens, usage.outputTokens),
      },
    });

    return { data, model, provider: providerName };
  } catch (error) {
    const isValidationFailure = error instanceof Error && error.message.includes("schema validation");
    await prisma.aIRun.update({
      where: { id: aiRun.id },
      data: {
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        validationFailed: isValidationFailure,
        latencyMs: Date.now() - start,
      },
    });
    throw error;
  }
}

export async function embed(params: {
  texts: string[];
  taskType: AITaskType;
  userId?: string;
}): Promise<number[][]> {
  const { provider: providerName, model } = resolveModelConfig(params.taskType);
  const provider = createProvider(providerName, getProviderConfig());
  const { vectors, usage } = await provider.embed(
    { texts: params.texts, taskType: params.taskType, userId: params.userId },
    model,
  );

  await prisma.aIRun.create({
    data: {
      userId: params.userId,
      taskType: params.taskType,
      agent: "embeddings",
      provider: providerName,
      model,
      input: { textsCount: params.texts.length },
      status: "success",
      latencyMs: usage.latencyMs,
    },
  });

  return vectors;
}
