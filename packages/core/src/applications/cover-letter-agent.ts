import { z } from "zod";
import { generateStructured } from "../ai/ai-client";
import type { NormalizedJob } from "../domain/job";
import type { ExperienceRecord } from "../domain/resume";

export const COVER_LETTER_STYLES = [
  "professional",
  "concise",
  "warm",
  "confident",
  "startup",
  "fintech",
] as const;
export type CoverLetterStyle = (typeof COVER_LETTER_STYLES)[number];

const STYLE_DIRECTIVES: Record<CoverLetterStyle, string> = {
  professional: "Formal, polished tone. Standard business-letter structure.",
  concise: "As short as possible while still specific — 3 short paragraphs max, no filler.",
  warm: "Personable and genuine, while still professional — like a thoughtful email to someone you respect.",
  confident: "Direct and assured — lead with the strongest relevant accomplishment, no hedging language.",
  startup: "Casual, energetic, a little informal — as if writing to a small founding team.",
  fintech: "Precise and risk-aware in tone, emphasizing reliability, compliance-mindedness, and ownership.",
};

const GENERIC_BOILERPLATE_DENYLIST = [
  /i am writing to express my interest/i,
  /highly motivated individual/i,
  /team player/i,
  /to whom it may concern/i,
  /dear hiring manager/i,
  /i believe i (would be|am) a great fit/i,
  /thank you for (considering|your consideration)/i,
];

const coverLetterOutputSchema = z.object({
  paragraphs: z.array(
    z.object({
      text: z.string(),
      sourceRecordIds: z.array(z.string()),
    }),
  ),
});

const SYSTEM_PROMPT = `You write a cover letter for a candidate applying to a specific job, for a
personal job-search platform.

Non-negotiable rules:
- Only reference experience/projects/achievements that are explicitly given to you in
  "candidateExperience" below — never invent or embellish an accomplishment, employer, or metric.
- Every paragraph must cite the sourceRecordIds (experience/project ids) its claims are drawn from.
- Avoid generic boilerplate ("I am writing to express my interest", "team player", "Dear Hiring
  Manager", "To Whom It May Concern") — write like a specific, thoughtful person, not a template.
- Ground the letter in the company/role's actual stated needs, not vague enthusiasm.`;

export interface CoverLetterInput {
  job: NormalizedJob;
  companyDescription?: string;
  candidateExperience: ExperienceRecord[];
  style: CoverLetterStyle;
  userId?: string;
}

export interface CoverLetterOutput {
  content: string;
  wordCount: number;
  genericPhrasesFlagged: string[];
}

export async function generateCoverLetter(input: CoverLetterInput): Promise<CoverLetterOutput> {
  const { data } = await generateStructured({
    schema: coverLetterOutputSchema,
    system: SYSTEM_PROMPT,
    prompt: `Style directive: ${STYLE_DIRECTIVES[input.style]}

Job:
Title: ${input.job.title}
Company: ${input.job.company.name}
${input.companyDescription ? `Company context: ${input.companyDescription}` : ""}
Requirements: ${input.job.requirements ?? input.job.description.slice(0, 3000)}

Candidate experience you may draw from (JSON, do not use anything outside this):
${JSON.stringify(input.candidateExperience, null, 2)}`,
    taskType: "COVER_LETTER",
    agent: "CoverLetterAgent",
    userId: input.userId,
    entityRef: { type: "job", id: input.job.sourceId },
  });

  const content = data.paragraphs.map((p) => p.text).join("\n\n");
  const genericPhrasesFlagged = GENERIC_BOILERPLATE_DENYLIST.filter((re) => re.test(content)).map((re) => re.source);

  return {
    content,
    wordCount: content.split(/\s+/).filter(Boolean).length,
    genericPhrasesFlagged,
  };
}
