import { z } from "zod";
import { generateStructured } from "../ai/ai-client";

const emailIntentSchema = z.object({
  classification: z.enum(["REJECTED", "OFFER", "INTERVIEW", "ACKNOWLEDGED", "UNRELATED"]),
  confidence: z.number(),
  reasoning: z.string(),
});
export type EmailIntentResult = z.infer<typeof emailIntentSchema>;

const SYSTEM_PROMPT = `You classify a single email as a stage in a job application process, for a
personal job-search dashboard. This email already looks job-related by a keyword search, but a
faster deterministic keyword pass could not confidently classify it — you are the fallback for the
ambiguous cases, so read the actual meaning/intent, not just surface keywords.

Classify into exactly one of:
- REJECTED: the candidate will not be moving forward / was not selected.
- OFFER: the candidate is being offered the job.
- INTERVIEW: the candidate is being invited to an interview, screening call, or next round.
- ACKNOWLEDGED: a generic "we received your application" / "under review" message with no other signal.
- UNRELATED: not actually a status update about a specific application (e.g. a job board digest,
  newsletter, alert, or an email that merely mentions job-related words in passing).

Base this ONLY on what the email text actually says. If it's ambiguous, prefer the most literal
reading over a hopeful or pessimistic guess, and reflect real uncertainty in "confidence" rather than
forcing false confidence — a wrong automatic status update on someone's job search dashboard is worse
than an email that gets left unclassified.`;

/**
 * AI fallback for `classifyEmail` (the free keyword pass) in
 * email-status-scanner.ts. Only ever called for messages the keyword pass
 * left as UNKNOWN, and only when there's already an identifiable target
 * (an existing application, or an inferable employer) to apply the result
 * to — see the caller for that gating, which keeps this bounded to a small
 * fraction of scanned emails rather than one AI call per message.
 */
export async function classifyEmailIntent(params: {
  subject: string;
  body: string;
  userId?: string;
}): Promise<EmailIntentResult> {
  const { data } = await generateStructured({
    schema: emailIntentSchema,
    system: SYSTEM_PROMPT,
    prompt: `Subject: ${params.subject}

Body:
${params.body.slice(0, 4000)}`,
    taskType: "EMAIL_CLASSIFICATION",
    agent: "EmailIntentAgent",
    userId: params.userId,
  });
  return data;
}
