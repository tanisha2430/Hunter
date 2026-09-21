import { z } from "zod";
import { prisma } from "@hunter/db";
import type { Profile } from "@hunter/db";
import { generateStructured } from "../ai/ai-client";
import type { NormalizedJob } from "../domain/job";
import type { ResumeParsedData } from "../domain/resume";

export interface ApplicationQuestion {
  id: string;
  text: string;
  type: "text" | "textarea" | "select" | "boolean" | "file" | "numeric";
  options?: string[];
  required: boolean;
}

export type AnswerSource = "profile_field" | "reused_answer" | "ai_generated" | "user_input_required";

export interface ResolvedAnswer {
  questionId: string;
  question: string;
  questionType: string;
  answer: string;
  source: AnswerSource;
  sourceDetail?: Record<string, unknown>;
  confidence: number;
  needsUserInput: boolean;
}

/**
 * Maps a question's text to a known profile field, if it's clearly asking
 * for one. This is the ONLY path for contact-info-shaped questions
 * (email/phone/work authorization/salary/notice period) — they are never
 * routed to `ai_generated`, by construction, not by prompt instruction.
 */
function matchProfileField(questionText: string, profile: Profile): { field: string; value: string } | null {
  const q = questionText.toLowerCase();

  if (/email/.test(q)) return profile.userId ? { field: "email", value: "" } : null; // email lives on User, resolved by caller
  if (/phone|mobile|contact number/.test(q) && profile.phone) return { field: "phone", value: profile.phone };
  if (/work authoriz|visa status|sponsorship/.test(q) && profile.workAuthorization) {
    return { field: "workAuthorization", value: profile.workAuthorization };
  }
  if (/notice period/.test(q) && profile.noticePeriodDays !== null) {
    return { field: "noticePeriodDays", value: `${profile.noticePeriodDays} days` };
  }
  if (/current (ctc|salary|compensation)/.test(q) && profile.desiredSalaryMin) {
    return { field: "currentSalary", value: "Prefer to discuss" };
  }
  if (/expected (ctc|salary|compensation)|salary expectation/.test(q) && profile.desiredSalaryMin) {
    const max = profile.desiredSalaryMax ?? profile.desiredSalaryMin;
    return { field: "desiredSalary", value: `${profile.desiredSalaryMin}-${max} ${profile.desiredCurrency}` };
  }
  if (/linkedin/.test(q) && profile.linkedinUrl) return { field: "linkedinUrl", value: profile.linkedinUrl };
  if (/github/.test(q) && profile.githubUrl) return { field: "githubUrl", value: profile.githubUrl };
  if (/portfolio|website/.test(q) && profile.portfolioUrl) return { field: "portfolioUrl", value: profile.portfolioUrl };
  if (/location|based in|city/.test(q) && profile.location) return { field: "location", value: profile.location };
  if (/years? of experience/.test(q) && profile.yearsExperience !== null) {
    return { field: "yearsExperience", value: `${profile.yearsExperience}` };
  }
  if (/relocat/.test(q)) return null; // genuinely needs a yes/no the profile doesn't structurally capture yet

  return null;
}

const aiAnswerSchema = z.object({
  answer: z.string(),
  groundedIn: z.array(z.string()),
  confident: z.boolean(),
});

const AI_ANSWER_SYSTEM_PROMPT = `You draft an answer to a job application question, for a personal
job-search platform. You are given the question, the job, and the candidate's resume.

Rules:
- Only use facts present in the provided resume/job context — never invent an accomplishment, years
  of experience, or fact not present there.
- Set "confident: false" if you cannot answer using only the given facts (e.g. the question asks
  about something genuinely not covered, like availability for a specific interview date, or a
  subjective negotiation point) — a low-confidence/unconfident answer is discarded by the caller in
  favor of asking the user directly, so it is always safe to be honest here.
- "groundedIn" must list which resume section(s) (e.g. "experience:exp-1", "skills") your answer
  draws from.`;

export async function resolveApplicationAnswers(params: {
  questions: ApplicationQuestion[];
  userId: string;
  userEmail: string;
  profile: Profile;
  job: NormalizedJob;
  resume: ResumeParsedData;
}): Promise<ResolvedAnswer[]> {
  const results: ResolvedAnswer[] = [];

  // Prior answers to near-identical questions: reuse verbatim, never
  // re-generate — the user's own words stand.
  const priorAnswers = await prisma.applicationAnswer.findMany({
    where: { application: { userId: params.userId }, source: { in: ["profile_field", "reused_answer", "user_input_required"] } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  for (const question of params.questions) {
    const normalizedQ = question.text.trim().toLowerCase();
    const reused = priorAnswers.find((a) => a.question.trim().toLowerCase() === normalizedQ && !a.needsUserInput);
    if (reused) {
      results.push({
        questionId: question.id,
        question: question.text,
        questionType: question.type,
        answer: reused.answer,
        source: "reused_answer",
        sourceDetail: { answerId: reused.id },
        confidence: 1,
        needsUserInput: false,
      });
      continue;
    }

    if (/^email$/.test(question.text.trim().toLowerCase()) || /email address/.test(normalizedQ)) {
      results.push({
        questionId: question.id,
        question: question.text,
        questionType: question.type,
        answer: params.userEmail,
        source: "profile_field",
        sourceDetail: { field: "email" },
        confidence: 1,
        needsUserInput: false,
      });
      continue;
    }

    const profileMatch = matchProfileField(question.text, params.profile);
    if (profileMatch && profileMatch.value) {
      results.push({
        questionId: question.id,
        question: question.text,
        questionType: question.type,
        answer: profileMatch.value,
        source: "profile_field",
        sourceDetail: { field: profileMatch.field },
        confidence: 1,
        needsUserInput: false,
      });
      continue;
    }

    // Boolean/select questions with a small option set are usually either a
    // known profile fact (handled above) or a genuine judgment call — not
    // worth an AI call for a coin-flip; ask the user.
    if (question.type === "boolean" || (question.type === "select" && (question.options?.length ?? 0) <= 2)) {
      results.push({
        questionId: question.id,
        question: question.text,
        questionType: question.type,
        answer: "",
        source: "user_input_required",
        confidence: 0,
        needsUserInput: true,
      });
      continue;
    }

    try {
      const { data: ai } = await generateStructured({
        schema: aiAnswerSchema,
        system: AI_ANSWER_SYSTEM_PROMPT,
        prompt: `Question: "${question.text}"

Job: ${params.job.title} at ${params.job.company.name}
Job requirements: ${params.job.requirements ?? params.job.description.slice(0, 2000)}

Candidate resume (JSON): ${JSON.stringify(params.resume)}`,
        taskType: "GENERAL",
        agent: "AnswerResolutionService",
        userId: params.userId,
        entityRef: { type: "application_question", id: question.id },
      });

      if (!ai.confident || !ai.answer.trim()) {
        results.push({
          questionId: question.id,
          question: question.text,
          questionType: question.type,
          answer: "",
          source: "user_input_required",
          confidence: 0,
          needsUserInput: true,
        });
        continue;
      }

      results.push({
        questionId: question.id,
        question: question.text,
        questionType: question.type,
        answer: ai.answer,
        source: "ai_generated",
        sourceDetail: { groundedIn: ai.groundedIn },
        confidence: 0.75,
        needsUserInput: false,
      });
    } catch {
      // AI failure -> never guess, ask the user instead.
      results.push({
        questionId: question.id,
        question: question.text,
        questionType: question.type,
        answer: "",
        source: "user_input_required",
        confidence: 0,
        needsUserInput: true,
      });
    }
  }

  return results;
}
