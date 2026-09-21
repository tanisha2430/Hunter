import { z } from "zod";
import { generateStructured } from "../ai/ai-client";

export const SUPPORTED_INTENTS = [
  "APPLY_TO_MATCHING",
  "SEARCH_JOBS",
  "SHOW_DASHBOARD_STAT",
  "UPDATE_SETTINGS",
  "CONTACT_COMPANY",
  "WITHDRAW_APPLICATION",
  "REJECT_JOB",
  "UNKNOWN",
] as const;
export type SupportedIntent = (typeof SUPPORTED_INTENTS)[number];

const parsedCommandSchema = z.object({
  intent: z.enum(SUPPORTED_INTENTS),
  confidence: z.number().min(0).max(1),
  minScore: z.number().min(0).max(100).optional(),
  maxScore: z.number().min(0).max(100).optional(),
  location: z.string().optional(),
  domain: z.string().optional(),
  minSalary: z.number().optional(),
  source: z.string().optional(),
  targetCompanyName: z.string().optional(),
  targetJobTitle: z.string().optional(),
  settingsKey: z.string().optional(),
  settingsValue: z.string().optional(),
});
export type ParsedCommand = z.infer<typeof parsedCommandSchema> & { rawText: string };

const SYSTEM_PROMPT = `You parse a free-text command from a job-search platform's command box into a
structured intent. You MUST choose "intent" from exactly this fixed set: ${SUPPORTED_INTENTS.join(", ")}.

You never take any action yourself — you only classify. If the text doesn't clearly match one of the
supported intents, or you're unsure, use "UNKNOWN" with low confidence rather than guessing. Extract
only filters/values that are explicitly stated in the text (e.g. a percentage, a location, a salary
figure) — never invent a number that wasn't said.

Examples:
"apply to all jobs above 85%" -> APPLY_TO_MATCHING, minScore: 85
"find fintech jobs in Bangalore paying above 10 LPA" -> SEARCH_JOBS, domain: "fintech", location: "Bangalore", minSalary: 1000000
"email this company" -> CONTACT_COMPANY
"how many replies this week" -> SHOW_DASHBOARD_STAT
"switch to selective strategy" -> UPDATE_SETTINGS, settingsKey: "searchStrategy", settingsValue: "SELECTIVE"`;

/**
 * NL -> structured intent only. This function has NO side effects — it
 * cannot execute anything itself, by construction (it returns data, not a
 * callback). CommandDispatcher (a fixed switch over SUPPORTED_INTENTS) is
 * the only thing that calls real service functions, and it re-validates
 * confidence/filter sanity before doing so.
 */
export async function parseCommand(text: string, userId?: string): Promise<ParsedCommand> {
  const { data } = await generateStructured({
    schema: parsedCommandSchema,
    system: SYSTEM_PROMPT,
    prompt: `Command: "${text}"`,
    taskType: "COMMAND_PARSE",
    agent: "CommandAgent",
    userId,
  });

  return { ...data, rawText: text };
}
