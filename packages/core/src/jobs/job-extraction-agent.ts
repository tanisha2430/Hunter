import { z } from "zod";
import { generateStructured } from "../ai/ai-client";
import type { NormalizedJob } from "../domain/job";

// No `.default(...)` on any field — see the long comment in domain/resume.ts
// for why: defaulted fields drop out of the JSON-Schema `required` list and
// Gemini's structured output then tends to omit them entirely rather than
// actually attempting extraction. `skills`/`remoteType`/`employmentType` are
// kept required (empty array / "UNKNOWN" are valid values, just always present).
const extractionResultSchema = z.object({
  title: z.string().optional(),
  companyName: z.string().optional(),
  skills: z.array(z.string()),
  experienceMin: z.number().optional(),
  experienceMax: z.number().optional(),
  salaryMin: z.number().optional(),
  salaryMax: z.number().optional(),
  currency: z.string().optional(),
  location: z.string().optional(),
  remoteType: z.enum(["ONSITE", "HYBRID", "REMOTE", "UNKNOWN"]),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "TEMPORARY", "UNKNOWN"]),
  seniorityLevel: z.string().optional(),
});

const SYSTEM_PROMPT = `You extract structured job-posting fields from raw job description text for a job
search platform. Only report a field if it is actually stated or clearly implied in the text — leave
it out (or use "UNKNOWN") rather than guessing a plausible-sounding value. Never invent a salary,
experience range, or company name that isn't in the text.`;

/**
 * Backfills fields an adapter's structured source didn't provide (most
 * commonly salary/experience range, which most public ATS APIs don't expose
 * as structured data) by extracting them from the free-text description.
 * Also the PRIMARY extraction path for MANUAL_PASTE and the generic
 * career-page fallback, where almost nothing is structured yet.
 */
export async function backfillJobFields(job: NormalizedJob, userId?: string): Promise<NormalizedJob> {
  const needsBackfill =
    !job.title ||
    !job.company.name ||
    job.salaryMin === undefined ||
    job.experienceMin === undefined ||
    job.skills.length === 0;

  if (!needsBackfill) return job;

  const sourceText = job.description || (job.rawData.fallbackText as string) || (job.rawData.rawText as string) || "";
  if (!sourceText.trim()) return job;

  const { data: extracted } = await generateStructured({
    schema: extractionResultSchema,
    system: SYSTEM_PROMPT,
    prompt: `Extract job posting fields from this text:\n\n${sourceText.slice(0, 12000)}`,
    taskType: "JOB_EXTRACTION",
    agent: "JobExtractionAgent",
    userId,
    entityRef: { type: "job_extraction", id: job.sourceId },
  });

  return {
    ...job,
    title: job.title || extracted.title || job.title,
    company: { ...job.company, name: job.company.name || extracted.companyName || job.company.name },
    description: job.description || sourceText,
    skills: job.skills.length > 0 ? job.skills : extracted.skills,
    experienceMin: job.experienceMin ?? extracted.experienceMin,
    experienceMax: job.experienceMax ?? extracted.experienceMax,
    salaryMin: job.salaryMin ?? extracted.salaryMin,
    salaryMax: job.salaryMax ?? extracted.salaryMax,
    currency: job.currency ?? extracted.currency,
    location: job.location ?? extracted.location,
    remoteType: job.remoteType !== "UNKNOWN" ? job.remoteType : extracted.remoteType,
    employmentType: job.employmentType !== "UNKNOWN" ? job.employmentType : extracted.employmentType,
    seniorityLevel: job.seniorityLevel ?? extracted.seniorityLevel,
  };
}
