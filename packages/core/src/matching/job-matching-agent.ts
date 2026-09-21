import { z } from "zod";
import { generateStructured } from "../ai/ai-client";
import type { NormalizedJob } from "../domain/job";
import type { ResumeParsedData } from "../domain/resume";

const aiScoresSchema = z.object({
  skillMatch: z.object({
    score: z.number().min(0).max(100),
    matchedSkills: z.array(z.string()),
    missingSkills: z.array(z.string()),
  }),
  roleMatch: z.object({ score: z.number().min(0).max(100) }),
  domainMatch: z.object({
    score: z.number().min(0).max(100),
    candidateDomains: z.array(z.string()),
    jobDomain: z.string().optional(),
  }),
  careerGoalMatch: z.object({ score: z.number().min(0).max(100), note: z.string().optional() }),
  strongSignals: z.array(z.string()),
  concerns: z.array(z.string()),
  whyMatch: z.string(),
  whyNot: z.string(),
  recommendation: z.enum(["apply", "consider", "skip"]),
  confidence: z.number().min(0).max(1),
});
export type AiMatchScores = z.infer<typeof aiScoresSchema>;

const SYSTEM_PROMPT = `You assess how well a candidate matches a job, for a personal job-search platform.

You are given the job's requirements/description, the candidate's resume (structured), and
DETERMINISTIC scores already computed for location/salary/experience/seniority/education — you are
NOT scoring those, only: skill match, role match, domain match, and career-goal match.

Critical rules:
- "missingSkills" and any skill referenced in "concerns" MUST come only from the job's actual stated
  requirements/skills — never invent a skill the job didn't ask for.
- "strongSignals" must be grounded in the candidate's ACTUAL resume content (real experience/projects/
  skills) — never invent or embellish the candidate's background.
- Your "recommendation" and "confidence" must be consistent with the overall picture (deterministic
  scores + your own scores here) — don't recommend "apply" for a candidate who clearly fails a hard
  requirement visible in the provided context.
- Be honest about weaknesses in "whyNot" and "concerns" — this tool is for the candidate's own
  decision-making, sugar-coating helps no one.`;

export interface MatchNarrativeInput {
  job: NormalizedJob;
  resume: ResumeParsedData;
  deterministicContext: Record<string, unknown>;
  targetTitles: string[];
  careerGoals?: string;
  userId?: string;
}

export async function scoreJobMatchWithAI(input: MatchNarrativeInput): Promise<AiMatchScores> {
  const { data } = await generateStructured({
    schema: aiScoresSchema,
    system: SYSTEM_PROMPT,
    prompt: `Job:
Title: ${input.job.title}
Company: ${input.job.company.name}
Description: ${input.job.description.slice(0, 6000)}
Requirements: ${input.job.requirements?.slice(0, 3000) ?? "(not separately listed)"}

Candidate:
Target titles: ${input.targetTitles.join(", ") || "(none specified)"}
Career goals: ${input.careerGoals ?? "(none specified)"}
Resume summary: ${input.resume.summary ?? "(none)"}
Experience: ${input.resume.experience.map((e) => `${e.title} at ${e.company} (${e.bullets.map((b) => b.text).join("; ")})`).join("\n")}
Skills: ${input.resume.skills.map((s) => s.name).join(", ")}
Domains: ${input.resume.domains.join(", ")}
Projects: ${input.resume.projects.map((p) => `${p.name}: ${p.description}`).join("\n")}`,
    context: input.deterministicContext,
    taskType: "JOB_MATCH_SCORING",
    agent: "JobMatchingAgent",
    userId: input.userId,
    entityRef: { type: "job", id: input.job.sourceId },
  });
  return data;
}
