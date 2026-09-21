import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  AIProvider,
  EmbedParams,
  GenerateStructuredParams,
  AiUsageRecord,
} from "../ai-provider";
import { UnsupportedOperationError } from "../ai-provider";

const STRUCTURED_OUTPUT_TOOL_NAME = "emit_result";

export class AnthropicProvider implements AIProvider {
  readonly name = "ANTHROPIC" as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generateStructured<T>(params: GenerateStructuredParams<T>, model: string) {
    const jsonSchema = zodToJsonSchema(params.schema, "schema").definitions?.schema ?? {};
    const start = Date.now();

    const contextBlock = params.context
      ? `\n\n<context>\n${JSON.stringify(params.context, null, 2)}\n</context>`
      : "";

    const response = await this.client.messages.create({
      model,
      max_tokens: params.maxOutputTokens ?? 4096,
      system: params.system,
      messages: [{ role: "user", content: `${params.prompt}${contextBlock}` }],
      tools: [
        {
          name: STRUCTURED_OUTPUT_TOOL_NAME,
          description: "Emit the structured result. This is the only way to respond.",
          input_schema: jsonSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: STRUCTURED_OUTPUT_TOOL_NAME },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) {
      throw new Error("Anthropic response did not include the expected tool_use block.");
    }

    const parsed = params.schema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new Error(
        `Anthropic structured output failed schema validation: ${parsed.error.message}`,
      );
    }

    const usage: AiUsageRecord = {
      provider: this.name,
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: 0,
      latencyMs: Date.now() - start,
    };

    return { data: parsed.data, usage };
  }

  async embed(_params: EmbedParams, _model: string): Promise<never> {
    // Anthropic has no native embeddings endpoint — the embedding task type
    // routes to a VoyageProvider/OpenAIProvider via model-router.ts instead.
    throw new UnsupportedOperationError(this.name, "embeddings");
  }
}
