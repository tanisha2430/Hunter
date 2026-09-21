import { z } from "zod";
import { generateStructured } from "../ai/ai-client";
import type { ExperienceRecord } from "../domain/resume";

const coldEmailSchema = z.object({
  subject: z.string(),
  bodyParagraphs: z.array(z.string()),
});

const SYSTEM_PROMPT = `You write a short cold outreach email from a job candidate to a company, for
a personal job-search platform. The candidate is expressing interest in working there (either about a
specific open role, or generally), not applying to a specific posting through an ATS.

Rules:
- Only reference the candidate's real experience given to you below — never invent an accomplishment.
- Keep it SHORT (3 short paragraphs max) — no spammy language, no "I am writing to express my
  interest", no mass-email feel. Write like a specific person who looked at this specific company.
- End with a clear, low-pressure call to action (e.g. asking if there's a relevant conversation worth
  having), not a demand.
- Never claim a referral, connection, or prior contact with the company that wasn't stated as true.`;

export interface ColdEmailInput {
  companyName: string;
  companyContext?: string;
  jobTitle?: string;
  candidateExperience: ExperienceRecord[];
  candidateHeadline?: string;
  userId?: string;
}

export interface ColdEmailOutput {
  subject: string;
  body: string;
}

export async function generateColdEmail(input: ColdEmailInput): Promise<ColdEmailOutput> {
  const { data } = await generateStructured({
    schema: coldEmailSchema,
    system: SYSTEM_PROMPT,
    prompt: `Company: ${input.companyName}
${input.companyContext ? `Company context: ${input.companyContext}` : ""}
${input.jobTitle ? `Role of interest: ${input.jobTitle}` : "No specific role — general interest in working there."}

Candidate headline: ${input.candidateHeadline ?? "(none)"}
Candidate experience (JSON, only source of truth): ${JSON.stringify(input.candidateExperience)}`,
    taskType: "OUTREACH_MESSAGE",
    agent: "OutreachAgent",
    userId: input.userId,
  });

  return { subject: data.subject, body: data.bodyParagraphs.join("\n\n") };
}
