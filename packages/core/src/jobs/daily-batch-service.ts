import { prisma } from "@hunter/db";
import { GeminiDailyQuotaExceededError } from "@hunter/ai";
import type { NormalizedJob, AtsType } from "../domain/job";
import { ingestJobs } from "./job-search-service";
import { recordFetchResult } from "../companies/company-source-service";
import { prescreenHardRejections } from "../matching/prescreen-service";
import { runJobMatch } from "../matching/job-matching-service";
import { createApplyBatch } from "../queue/apply-batch-service";
import { deriveRelevanceKeywords, isTitleLikelyRelevant } from "./job-relevance";

/**
 * Job-source adapter surface this needs — kept as a parameter rather than an
 * import so `packages/core` doesn't have to depend on `packages/adapters`
 * (see the architecture note on that dependency direction). Both callers
 * (the cron route and the manual-trigger action) already have
 * `@hunter/adapters` available and just pass its exports through.
 */
export interface DailyBatchAdapters {
  getJobSourceAdapter: (atsType: AtsType) => {
    searchJobs: (params: { companySourceId: string; externalToken: string }) => Promise<{ jobs: NormalizedJob[] }>;
  };
  genericCareerPageAdapter: { discoverJobs: (url: string) => Promise<NormalizedJob[]> };
  isAdapterNotConnectedError: (err: unknown) => boolean;
}

export interface DailyBatchResult {
  sourcesRefreshed: number;
  totalSources: number;
  jobsIngested: number;
  scored: number;
  quotaExceeded: boolean;
  stillUnscored: number;
  applicationsPrepared: number;
  applicationsNeedInput: number;
  applicationsFailed: number;
  log: string[];
}

/**
 * The full daily pipeline: refresh every active company source (no AI) ->
 * prescreen hard-rejections (no AI) -> score unscored jobs, title-relevance
 * prioritized and capped (real AI, stops immediately on daily quota
 * exhaustion rather than retrying) -> prepare (draft, NEVER submit)
 * applications at/above threshold. Shared by the cron-triggered route
 * (apps/web/app/api/internal/daily-batch) and the manual "Run now" button
 * (apps/web/app/(app)/dashboard), so there's exactly one implementation to
 * keep correct rather than two copies drifting apart.
 */
export async function runDailyBatchForUser(
  userId: string,
  adapters: DailyBatchAdapters,
  options: { scoreCap?: number; minScore?: number } = {},
): Promise<DailyBatchResult> {
  const log: string[] = [];
  const record = (line: string) => {
    log.push(line);
    console.log(`[daily-batch] ${line}`);
  };

  record("Starting daily batch run.");

  // ---- Step 1: refresh every active company source (no AI) ----
  const sources = await prisma.companySource.findMany({ where: { isActive: true }, include: { company: true } });
  let sourcesRefreshed = 0;
  let jobsIngested = 0;

  for (const source of sources) {
    try {
      let jobs: NormalizedJob[];
      if (source.atsType === "GENERIC_CAREER_PAGE") {
        jobs = await adapters.genericCareerPageAdapter.discoverJobs(source.boardUrl ?? source.externalToken);
      } else {
        const adapter = adapters.getJobSourceAdapter(source.atsType);
        const result = await adapter.searchJobs({ companySourceId: source.id, externalToken: source.externalToken });
        jobs = result.jobs;
      }
      const results = await ingestJobs(jobs, userId);
      await prescreenHardRejections(
        userId,
        results.map((r) => r.jobId),
      );
      await recordFetchResult(source.id, "ok");
      sourcesRefreshed++;
      jobsIngested += jobs.length;
    } catch (err) {
      const status = adapters.isAdapterNotConnectedError(err)
        ? "not_connected"
        : (`error:${(err as Error).message.slice(0, 100)}` as const);
      await recordFetchResult(source.id, status);
    }
  }
  record(`Refreshed ${sourcesRefreshed}/${sources.length} source(s), ingested ${jobsIngested} posting(s).`);

  // ---- Step 2: score unscored jobs, title-relevance prioritized, capped ----
  const scoreCap = options.scoreCap ?? Number(process.env.DAILY_SCORE_CAP ?? 40);
  const [unscored, profile] = await Promise.all([
    prisma.job.findMany({
      where: { isActive: true, jobMatches: { none: { userId } } },
      select: { id: true, title: true },
      orderBy: { firstSeenAt: "desc" },
    }),
    prisma.profile.findUnique({ where: { userId } }),
  ]);
  const keywords = deriveRelevanceKeywords([...(profile?.targetTitles ?? []), profile?.currentTitle ?? ""]);
  const prioritized = [...unscored].sort((a, b) => {
    const aRelevant = isTitleLikelyRelevant(a.title, keywords) ? 0 : 1;
    const bRelevant = isTitleLikelyRelevant(b.title, keywords) ? 0 : 1;
    return aRelevant - bRelevant;
  });
  const toScore = prioritized.slice(0, scoreCap);

  let scored = 0;
  let quotaExceeded = false;
  for (const job of toScore) {
    try {
      await runJobMatch({ userId, jobId: job.id });
      scored++;
    } catch (err) {
      if (err instanceof GeminiDailyQuotaExceededError) {
        quotaExceeded = true;
        break;
      }
      console.error(`[daily-batch] Failed to score job ${job.id}:`, err);
    }
  }
  const stillUnscored = Math.max(0, unscored.length - toScore.length);
  record(
    `Scored ${scored}/${toScore.length} job(s)${quotaExceeded ? " — stopped early: daily AI quota exhausted" : ""}. ${stillUnscored} still waiting.`,
  );

  // ---- Step 3: prepare (draft, NOT submit) applications at/above threshold ----
  const minScore = options.minScore ?? Number(process.env.DAILY_MIN_SCORE ?? 85);
  const batchResult = await createApplyBatch(userId, { minScore });
  record(
    `Prepared ${batchResult.preparedCount}/${batchResult.totalCandidates} application(s) >= ${minScore}% ` +
      `(${batchResult.needsInputCount} need input, ${batchResult.failedCount} failed). Nothing submitted — review in Applications.`,
  );

  record("Daily batch run complete.");

  return {
    sourcesRefreshed,
    totalSources: sources.length,
    jobsIngested,
    scored,
    quotaExceeded,
    stillUnscored,
    applicationsPrepared: batchResult.preparedCount,
    applicationsNeedInput: batchResult.needsInputCount,
    applicationsFailed: batchResult.failedCount,
    log,
  };
}
