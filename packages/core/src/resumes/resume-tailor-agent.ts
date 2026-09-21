import { generateStructured } from "../ai/ai-client";
import { tailoredResumePlanSchema, type TailoredResumePlan, type ResumeParsedData } from "../domain/resume";
import type { NormalizedJob } from "../domain/job";

const SYSTEM_PROMPT = `You tailor a candidate's resume for a specific job, for a job-search platform.

You are given the candidate's SOURCE resume (structured, with stable ids on every experience/project/
bullet) and the target job. Produce a TailoredResumePlan: which sections/bullets to include, in what
order, and how to reword each bullet for impact and keyword relevance to this job.

Non-negotiable rules:
- Every bullet you emit MUST reference a real "sourceBulletId" that exists in the source resume
  provided to you. You may reorder, reword for concision/impact, and select which bullets to include
  or drop — you may NEVER invent an employer, title, date, technology, or metric that isn't in the
  source.
- "emphasizedKeywords" for a bullet must be terms that are BOTH in the job's requirements AND already
  present in that bullet's source content — never a keyword the candidate doesn't actually have.
- Rewording should improve clarity/impact/keyword alignment, not change the underlying facts. If you
  cannot improve a bullet without changing its facts, keep it close to the original wording.
- The summary must cite the sourceRecordIds (experience/project ids) its claims are drawn from.`;

export interface TailorResumeInput {
  job: NormalizedJob;
  sourceResume: ResumeParsedData;
  sourceResumeId: string;
  userId?: string;
}

export async function generateTailoredResumePlan(input: TailorResumeInput): Promise<TailoredResumePlan> {
  const { data } = await generateStructured({
    schema: tailoredResumePlanSchema,
    system: SYSTEM_PROMPT,
    prompt: `Target job:
Title: ${input.job.title}
Company: ${input.job.company.name}
Requirements: ${input.job.requirements ?? input.job.description.slice(0, 3000)}

Source resume (JSON):
${JSON.stringify(input.sourceResume, null, 2)}`,
    taskType: "RESUME_TAILORING",
    agent: "ResumeTailorAgent",
    userId: input.userId,
    entityRef: { type: "job", id: input.job.sourceId },
  });

  return { ...data, targetJobId: input.job.sourceId, sourceResumeId: input.sourceResumeId };
}
