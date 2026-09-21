"use server";

import { revalidatePath } from "next/cache";
import { runJobMatch, createApplyBatch, listFreshUnscoredJobs, ingestJobs } from "@hunter/core";
import { getJobSourceAdapter, genericCareerPageAdapter, AdapterNotConnectedError } from "@hunter/adapters";
import { prisma } from "@hunter/db";
import { createClient } from "@/lib/supabase/server";

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return user.id;
}

/**
 * Re-fetches every already-added company source for new postings — AI-free
 * (see job-ingestion-service.ts's `useAI` note), so it costs no quota.
 *
 * IMPORTANT: this is explicit (a button the user clicks), NOT run
 * automatically on page load. A large board (Stripe: 633 postings) can take
 * several seconds to fully re-ingest; running it synchronously inside the
 * page's render made every visit slow, and — worse — reloading the slow page
 * started a SECOND concurrent refresh that raced the first one over the same
 * jobs, causing real unique-constraint errors (verified: this happened,
 * wasn't hypothetical). An explicit, single button press avoids both problems.
 */
export async function refreshAllSources(): Promise<{ refreshed: number; newJobs: number }> {
  const userId = await requireUserId();
  const sources = await prisma.companySource.findMany({ where: { isActive: true }, include: { company: true } });

  let refreshed = 0;
  let newJobs = 0;

  for (const source of sources) {
    try {
      let jobCount = 0;
      if (source.atsType === "GENERIC_CAREER_PAGE") {
        const jobs = await genericCareerPageAdapter.discoverJobs(source.boardUrl ?? source.externalToken);
        await ingestJobs(jobs, userId);
        jobCount = jobs.length;
      } else {
        const adapter = getJobSourceAdapter(source.atsType);
        const { jobs } = await adapter.searchJobs({
          companySourceId: source.id,
          externalToken: source.externalToken,
        });
        await ingestJobs(jobs, userId);
        jobCount = jobs.length;
      }
      await prisma.companySource.update({
        where: { id: source.id },
        data: { lastFetchedAt: new Date(), lastFetchStatus: "ok" },
      });
      refreshed++;
      newJobs += jobCount;
    } catch (err) {
      const status = err instanceof AdapterNotConnectedError ? "not_connected" : `error:${(err as Error).message.slice(0, 100)}`;
      await prisma.companySource.update({
        where: { id: source.id },
        data: { lastFetchedAt: new Date(), lastFetchStatus: status },
      });
    }
  }

  revalidatePath("/jobs/fresh");
  return { refreshed, newJobs };
}

const SCORE_BATCH_CAP = 10;

/**
 * Scores up to SCORE_BATCH_CAP fresh, not-yet-scored jobs. Deliberately
 * bounded and explicit (a button the user clicks) rather than automatic on
 * every page load — each score is a real AI call, and silently scoring an
 * unbounded number of new jobs on every visit could burn the daily quota
 * without the user ever choosing to spend it.
 */
export async function scoreNewFreshJobs(): Promise<{ scored: number; remaining: number }> {
  const userId = await requireUserId();
  const unscored = await listFreshUnscoredJobs(userId);
  const toScore = unscored.slice(0, SCORE_BATCH_CAP);

  let scored = 0;
  for (const job of toScore) {
    try {
      await runJobMatch({ userId, jobId: job.id });
      scored++;
    } catch (err) {
      console.error(`Failed to score job ${job.id}:`, err);
    }
  }

  revalidatePath("/jobs/fresh");
  return { scored, remaining: Math.max(0, unscored.length - toScore.length) };
}

export interface ApplyFreshState {
  message?: string;
  error?: string;
}

export async function applyToFreshMatches(
  _prevState: ApplyFreshState,
  formData: FormData,
): Promise<ApplyFreshState> {
  const userId = await requireUserId();
  const minScore = Number(formData.get("minScore") ?? 85);
  try {
    const result = await createApplyBatch(userId, { minScore, postedWithinDays: 3 });
    revalidatePath("/applications");
    revalidatePath("/jobs/fresh");
    return {
      message: `${result.totalCandidates} newly-discovered job(s) (last 3 days) ≥ ${minScore}%. Prepared ${result.preparedCount} for review in Applications (${result.needsInputCount} need more input, ${result.failedCount} failed).`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Batch failed." };
  }
}
