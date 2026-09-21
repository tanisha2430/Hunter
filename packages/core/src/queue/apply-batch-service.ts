import { prisma } from "@hunter/db";
import { getEffectiveThreshold } from "../domain/match";
import { prepareApplication } from "../applications/application-service";
import { transition } from "../applications/application-state-machine";

export interface ApplyBatchFilters {
  minScore?: number;
  source?: string;
  domain?: string;
  /** Only jobs first discovered (firstSeenAt) within this many days — see the
   * long comment on listFreshMatchedJobs in job-search-service.ts for why
   * this uses discovery date, not the source's stated posting date. */
  postedWithinDays?: number;
}

export interface BatchApplicationItem {
  applicationId: string;
  jobId: string;
  jobTitle: string;
  company: string;
  overallScore: number;
  automatable: boolean;
  manualActionRequired: boolean;
  applyUrl?: string;
  blockingQuestions: string[];
  status: "PREPARED" | "FAILED";
}

export interface ApplyBatchResult {
  totalCandidates: number;
  preparedCount: number;
  needsInputCount: number;
  failedCount: number;
  items: BatchApplicationItem[];
}

/**
 * "Apply to all above X%": finds MATCHED/SHORTLISTED jobs at or above the
 * effective threshold, re-checks they weren't hard-rejected since scoring,
 * and runs the ApplicationAgent pipeline for each into READY_FOR_REVIEW.
 * This only PREPARES applications — nothing is approved or submitted here.
 * No currently-registered adapter supports automatedApply (see
 * packages/adapters), so every prepared application is `manualActionRequired`
 * until/unless a future adapter changes that; this is not hardcoded
 * optimism, it reflects the actual current adapter set.
 */
export async function createApplyBatch(userId: string, filters: ApplyBatchFilters): Promise<ApplyBatchResult> {
  const settings = await prisma.settings.findUnique({ where: { userId } });
  const threshold =
    filters.minScore ??
    getEffectiveThreshold({
      searchStrategy: settings?.searchStrategy ?? "BALANCED",
      customThreshold: settings?.customThreshold,
    });

  const freshSince = filters.postedWithinDays
    ? new Date(Date.now() - filters.postedWithinDays * 24 * 60 * 60 * 1000)
    : undefined;

  const matches = await prisma.jobMatch.findMany({
    where: {
      userId,
      hardRejected: false,
      overallScore: { gte: threshold },
      job: {
        isActive: true,
        ...(freshSince ? { firstSeenAt: { gte: freshSince } } : {}),
      },
    },
    include: { job: { include: { company: true } } },
    orderBy: { overallScore: "desc" },
  });

  const items: BatchApplicationItem[] = [];
  let preparedCount = 0;
  let needsInputCount = 0;
  let failedCount = 0;

  for (const match of matches) {
    const existing = await prisma.application.findUnique({
      where: { userId_jobId: { userId, jobId: match.jobId } },
    });
    if (existing && !["DISCOVERED", "MATCHED", "SHORTLISTED"].includes(existing.status)) {
      continue; // already further along the pipeline — skip, don't re-prepare
    }

    try {
      const result = await prepareApplication({ userId, jobId: match.jobId });
      const automatable = false; // no adapter currently supports automatedApply
      await prisma.application.update({
        where: { id: result.applicationId },
        data: { automatable, manualActionRequired: true },
      });

      items.push({
        applicationId: result.applicationId,
        jobId: match.jobId,
        jobTitle: match.job.title,
        company: match.job.company.name,
        overallScore: match.overallScore,
        automatable,
        manualActionRequired: true,
        applyUrl: match.job.applicationUrl,
        blockingQuestions: result.blockingQuestions,
        status: "PREPARED",
      });

      if (result.blockingQuestions.length > 0) needsInputCount++;
      preparedCount++;
    } catch (error) {
      failedCount++;
      items.push({
        applicationId: "",
        jobId: match.jobId,
        jobTitle: match.job.title,
        company: match.job.company.name,
        overallScore: match.overallScore,
        automatable: false,
        manualActionRequired: true,
        blockingQuestions: [],
        status: "FAILED",
      });
      console.error(`Failed to prepare application for job ${match.jobId}:`, error);
    }
  }

  return { totalCandidates: matches.length, preparedCount, needsInputCount, failedCount, items };
}

export interface ApproveResult {
  approvedCount: number;
  manualActionRequiredCount: number;
}

/**
 * Approves one or more READY_FOR_REVIEW applications. This is ALWAYS an
 * explicit user action (single click or this batch call) — never triggered
 * automatically by a command parse or the AI layer. Submission is only
 * attempted for adapters with automatedApply (none currently); everything
 * else surfaces MANUAL_ACTION_REQUIRED with the real apply URL, and stays
 * APPROVED (not SUBMITTED) until the user confirms they applied manually.
 */
export async function approveApplications(userId: string, applicationIds: string[]): Promise<ApproveResult> {
  let approvedCount = 0;
  let manualActionRequiredCount = 0;

  for (const applicationId of applicationIds) {
    const app = await prisma.application.findFirst({ where: { id: applicationId, userId } });
    if (!app || app.status !== "READY_FOR_REVIEW") continue;

    await transition(applicationId, "APPROVED", "batch_approve");
    approvedCount++;

    if (app.automatable) {
      // No adapter currently implements automated submission — this branch
      // is a documented no-op placeholder for when one does.
    } else {
      manualActionRequiredCount++;
    }
  }

  return { approvedCount, manualActionRequiredCount };
}

export async function rejectApplications(userId: string, applicationIds: string[]): Promise<void> {
  for (const applicationId of applicationIds) {
    const app = await prisma.application.findFirst({ where: { id: applicationId, userId } });
    if (!app) continue;
    await transition(applicationId, "REJECTED", "user").catch(() => {});
  }
}

/** User explicitly confirms they submitted a MANUAL_ACTION_REQUIRED application themselves. */
export async function confirmManualSubmission(userId: string, applicationId: string): Promise<void> {
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId } });
  if (!app || app.status !== "APPROVED") {
    throw new Error("Application must be APPROVED before it can be marked as manually submitted.");
  }
  await transition(applicationId, "SUBMITTED", "user");
  await prisma.application.update({ where: { id: applicationId }, data: { appliedAt: new Date() } });
}
