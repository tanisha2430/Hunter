import { prisma } from "@hunter/db";
import type { NormalizedJob } from "../domain/job";
import { evaluateHardRejectionRules, DEFAULT_HARD_REJECTION_RULES, type HardRejectionRules } from "./hard-rejection-rules";

/**
 * Runs ONLY the free, deterministic hard-rejection check (no AI call) against
 * jobs the user hasn't been matched against yet, and persists a JobMatch row
 * for the ones that fail it. Jobs that pass are left with no JobMatch row at
 * all — same as "never scored" today — so the existing AI-scoring flow picks
 * them up later; the point here is purely to keep that backlog limited to
 * jobs that could plausibly be relevant, without spending any AI quota.
 *
 * Called right after ingestion (see job-search-service.ts's callers) so a
 * newly-added company's board doesn't quietly pile up hundreds of
 * obviously-wrong-location/wrong-stack postings in the "unscored" bucket —
 * this is what actually keeps "Jobs"/"Fresh Matches" from filling up with
 * irrelevant postings, not the AI scoring step (which only ever sees
 * whatever gets through this filter).
 */
export async function prescreenHardRejections(userId: string, jobIds?: string[]): Promise<{ checked: number; rejected: number }> {
  const [profile, settings, resumeVersion] = await Promise.all([
    prisma.profile.findUnique({ where: { userId } }),
    prisma.settings.findUnique({ where: { userId } }),
    prisma.resumeVersion.findFirst({
      where: { resume: { userId, isPrimary: true } },
      orderBy: { versionNumber: "desc" },
    }),
  ]);
  // Nothing sensible to persist a per-resume JobMatch against yet.
  if (!resumeVersion) return { checked: 0, rejected: 0 };

  const rules = (settings?.hardRejectionRules as unknown as HardRejectionRules) ?? DEFAULT_HARD_REJECTION_RULES;

  const jobs = await prisma.job.findMany({
    where: {
      isActive: true,
      ...(jobIds ? { id: { in: jobIds } } : {}),
      jobMatches: { none: { userId } },
    },
    include: { jobSkills: { include: { skill: true } } },
  });

  let rejected = 0;
  for (const job of jobs) {
    const normalizedJob: NormalizedJob = {
      sourceId: job.id,
      sourceUrl: job.applicationUrl,
      atsType: "MANUAL_PASTE",
      title: job.title,
      company: { name: "" },
      description: job.description,
      requirements: job.requirements ?? undefined,
      skills: job.jobSkills.map((js) => js.skill.name),
      experienceMin: job.experienceMin ?? undefined,
      experienceMax: job.experienceMax ?? undefined,
      salaryMin: job.salaryMin ?? undefined,
      salaryMax: job.salaryMax ?? undefined,
      currency: job.currency ?? undefined,
      location: job.location ?? undefined,
      locationCountry: job.locationCountry ?? undefined,
      remoteType: job.remoteType,
      employmentType: job.employmentType,
      applicationUrl: job.applicationUrl,
      rawData: {},
    };

    const result = evaluateHardRejectionRules(rules, {
      job: normalizedJob,
      candidateYearsExperience: profile?.yearsExperience ?? undefined,
    });

    if (result.rejected) {
      rejected++;
      await prisma.jobMatch.upsert({
        where: { userId_jobId_resumeVersionId: { userId, jobId: job.id, resumeVersionId: resumeVersion.id } },
        create: {
          userId,
          jobId: job.id,
          resumeVersionId: resumeVersion.id,
          overallScore: 0,
          scoreBreakdown: {},
          hardRejected: true,
          rejectionReasons: result.reasons,
        },
        update: { hardRejected: true, rejectionReasons: result.reasons, overallScore: 0 },
      });
    }
  }

  return { checked: jobs.length, rejected };
}
