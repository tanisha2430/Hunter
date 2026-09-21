import { prisma } from "@hunter/db";
import type { NormalizedJob } from "../domain/job";
import { ingestJob, type IngestJobResult } from "./job-ingestion-service";

/**
 * `useAI` defaults to false: this is the bulk path (a board fetch can be
 * hundreds of postings), and per-job AI backfill/embedding calls at that
 * volume both take far too long and can exhaust a free-tier daily quota in
 * one click. Pass `useAI: true` only for genuinely single-job flows (manual
 * paste), where AI extraction is the primary point of the call, not an
 * incidental enrichment.
 */
export async function ingestJobs(
  jobs: NormalizedJob[],
  userId?: string,
  options: { useAI?: boolean } = {},
): Promise<IngestJobResult[]> {
  const results: IngestJobResult[] = [];
  for (const job of jobs) {
    try {
      results.push(await ingestJob(job, { userId, useAI: options.useAI ?? false }));
    } catch (error) {
      // One bad posting shouldn't abort an entire board fetch.
      console.error(`Failed to ingest job "${job.title}" from ${job.atsType}:`, error);
    }
  }
  return results;
}

export interface JobListFilters {
  minScore?: number;
  source?: string;
  location?: string;
  remoteOnly?: boolean;
}

export async function listJobsForUser(userId: string, filters: JobListFilters = {}) {
  return prisma.job.findMany({
    where: {
      isActive: true,
      ...(filters.remoteOnly ? { remoteType: "REMOTE" } : {}),
      ...(filters.location ? { location: { contains: filters.location, mode: "insensitive" } } : {}),
      ...(filters.source ? { jobSources: { some: { atsType: filters.source as never } } } : {}),
      ...(filters.minScore !== undefined
        ? { jobMatches: { some: { userId, overallScore: { gte: filters.minScore } } } }
        : {}),
    },
    include: {
      company: true,
      jobMatches: { where: { userId }, take: 1, orderBy: { computedAt: "desc" } },
    },
    orderBy: { firstSeenAt: "desc" },
    take: 100,
  });
}

function freshSinceDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * "Fresh" means newly discovered BY YOU (firstSeenAt), not recently posted
 * BY THE COMPANY (postedAt). Filtering on postedAt seemed right at first,
 * but it breaks the very first time you add a company's board: a real board
 * is mostly jobs the company posted weeks or months ago (they stay open
 * that long), so almost none would pass a "postedAt within 3 days" filter —
 * verified this directly: of 770 freshly-imported jobs, only 37 had a
 * postedAt inside the window, making a brand-new import look nearly empty.
 * firstSeenAt is what actually answers "is this new to me" and holds up
 * for every future incremental refresh too, not just this one.
 */
export async function listFreshMatchedJobs(userId: string, threshold: number, days = 3) {
  const since = freshSinceDate(days);
  return prisma.job.findMany({
    where: {
      isActive: true,
      firstSeenAt: { gte: since },
      jobMatches: { some: { userId, overallScore: { gte: threshold }, hardRejected: false } },
    },
    include: {
      company: true,
      jobMatches: { where: { userId }, take: 1, orderBy: { computedAt: "desc" } },
    },
    orderBy: { firstSeenAt: "desc" },
    take: 100,
  });
}

/** Fresh (newly discovered) jobs that don't have a match score for this user yet — candidates for "Score all new". */
export async function listFreshUnscoredJobs(userId: string, days = 3) {
  const since = freshSinceDate(days);
  return prisma.job.findMany({
    where: {
      isActive: true,
      firstSeenAt: { gte: since },
      jobMatches: { none: { userId } },
    },
    include: { company: true },
    orderBy: { firstSeenAt: "desc" },
    take: 100,
  });
}

export async function getJobWithMatch(jobId: string, userId: string) {
  return prisma.job.findUnique({
    where: { id: jobId },
    include: {
      company: true,
      jobSources: true,
      jobMatches: { where: { userId }, take: 1, orderBy: { computedAt: "desc" } },
    },
  });
}
