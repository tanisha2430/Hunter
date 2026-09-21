"use server";

import { revalidatePath } from "next/cache";
import {
  addCompanySource,
  removeCompanySource,
  recordFetchResult,
  ingestJobs,
  runJobMatch,
  prescreenHardRejections,
  deriveRelevanceKeywords,
  isTitleLikelyRelevant,
} from "@hunter/core";
import { GeminiDailyQuotaExceededError } from "@hunter/ai";
import { prisma } from "@hunter/db";
import {
  getJobSourceAdapter,
  genericCareerPageAdapter,
  fetchManualPasteShell,
  searchAdzunaJobs,
  AdapterNotConnectedError,
  RobotsDisallowedError,
} from "@hunter/adapters";
import { createClient } from "@/lib/supabase/server";

export interface AddSourceState {
  error?: string;
  success?: string;
}

const TOKEN_BASED_ATS = new Set(["GREENHOUSE", "LEVER", "ASHBY", "SMARTRECRUITERS", "INDEED", "NAUKRI", "CUTSHORT"]);

export async function addAndFetchCompanySource(
  _prevState: AddSourceState,
  formData: FormData,
): Promise<AddSourceState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const companyName = String(formData.get("companyName") ?? "").trim();
  const atsType = String(formData.get("atsType") ?? "");
  const tokenOrUrl = String(formData.get("tokenOrUrl") ?? "").trim();

  if (!companyName || !atsType || !tokenOrUrl) {
    return { error: "Company name, source type, and token/URL are all required." };
  }

  try {
    if (atsType === "GENERIC_CAREER_PAGE") {
      const { companyId, companySourceId } = await addCompanySource({
        companyName,
        atsType: "GENERIC_CAREER_PAGE",
        externalToken: tokenOrUrl,
        boardUrl: tokenOrUrl,
      });
      try {
        const jobs = await genericCareerPageAdapter.discoverJobs(tokenOrUrl);
        const results = await ingestJobs(jobs, user.id);
        await prescreenHardRejections(user.id, results.map((r) => r.jobId));
        await recordFetchResult(companySourceId, "ok");
        revalidatePath("/jobs");
        return { success: `Fetched ${jobs.length} job(s) from ${companyName}'s careers page.` };
      } catch (err) {
        const status = err instanceof RobotsDisallowedError ? "blocked_by_robots" : `error:${(err as Error).message.slice(0, 100)}`;
        await recordFetchResult(companySourceId, status as never);
        return { error: err instanceof Error ? err.message : "Failed to fetch career page." };
      }
    }

    if (!TOKEN_BASED_ATS.has(atsType)) {
      return { error: `Unsupported source type "${atsType}".` };
    }

    const { companySourceId } = await addCompanySource({
      companyName,
      atsType: atsType as never,
      externalToken: tokenOrUrl,
    });

    try {
      const adapter = getJobSourceAdapter(atsType as never);
      const { jobs } = await adapter.searchJobs({ companySourceId, externalToken: tokenOrUrl });
      const results = await ingestJobs(jobs, user.id);
      await prescreenHardRejections(user.id, results.map((r) => r.jobId));
      await recordFetchResult(companySourceId, "ok");
      revalidatePath("/jobs");
      return { success: `Fetched ${jobs.length} job(s) from ${companyName} via ${atsType}.` };
    } catch (err) {
      if (err instanceof AdapterNotConnectedError) {
        await recordFetchResult(companySourceId, "not_connected");
        return { error: err.message };
      }
      await recordFetchResult(companySourceId, `error:${(err as Error).message.slice(0, 100)}` as never);
      return { error: err instanceof Error ? err.message : "Failed to fetch jobs." };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export interface PasteJobState {
  error?: string;
  success?: string;
}

export async function pasteJob(_prevState: PasteJobState, formData: FormData): Promise<PasteJobState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const url = String(formData.get("url") ?? "").trim();
  const rawText = String(formData.get("rawText") ?? "").trim();
  if (!url && !rawText) return { error: "Paste a job URL or the job description text." };

  try {
    const shell = await fetchManualPasteShell({ url: url || undefined, rawText: rawText || undefined });
    // Manual paste is the one bulk-path caller that needs AI: there's no
    // structured source data at all here, unlike a board fetch.
    const results = await ingestJobs([shell], user.id, { useAI: true });
    await prescreenHardRejections(user.id, results.map((r) => r.jobId));
    revalidatePath("/jobs");
    return { success: "Job added — AI is extracting structured fields from it." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to add job." };
  }
}

export interface AdzunaSearchState {
  error?: string;
  success?: string;
}

export async function searchAdzunaAction(_prevState: AdzunaSearchState, formData: FormData): Promise<AdzunaSearchState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return { error: "Adzuna isn't configured (missing ADZUNA_APP_ID/ADZUNA_APP_KEY)." };

  const what = String(formData.get("what") ?? "").trim();
  const where = String(formData.get("where") ?? "").trim();
  if (!what) return { error: "Enter keywords to search for." };

  try {
    const { jobs, totalCount } = await searchAdzunaJobs({
      appId,
      appKey,
      what,
      where: where || undefined,
      resultsPerPage: 30,
    });
    const results = await ingestJobs(jobs, user.id);
    await prescreenHardRejections(user.id, results.map((r) => r.jobId));
    revalidatePath("/jobs");
    return {
      success: `Adzuna has ${totalCount.toLocaleString()} matching posting(s) total — imported ${jobs.length} from this search.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Adzuna search failed." };
  }
}

export async function runMatchForJob(jobId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await runJobMatch({ userId: user.id, jobId }).catch((err) => {
    console.error("Match failed:", err);
  });
  revalidatePath("/jobs");
}

export async function removeCompanySourceAction(companySourceId: string) {
  await removeCompanySource(companySourceId);
  revalidatePath("/jobs");
}

/**
 * Runs the free hard-rejection pre-screen (no AI) across every currently
 * unscored active job, not just newly-ingested ones — a manual "catch up"
 * for jobs that slipped through before this ran automatically on ingestion,
 * or after a hard-rejection rule change in Settings. Safe to run as often as
 * wanted; unlike a "score everything" action this can never touch the AI
 * quota, since it only ever persists hard-rejections and leaves passing
 * jobs for the existing capped "Score new" flow.
 */
export async function prescreenAllJobsAction(): Promise<{ checked: number; rejected: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { checked: 0, rejected: 0 };
  const result = await prescreenHardRejections(user.id);
  revalidatePath("/jobs");
  revalidatePath("/jobs/fresh");
  return result;
}

const SCORE_BATCH_CAP = 10;

/**
 * Bulk-scores the next batch of unscored jobs — NOT limited to the last 3
 * days like the Fresh Matches page's scorer, since most of the backlog this
 * exists to work through is older than that. Each score is a real AI call,
 * so this stays capped and explicit like every other AI-spending action.
 *
 * Prioritizes jobs whose title plausibly matches the candidate's target
 * titles first (free, deterministic) — otherwise the scarce daily AI quota
 * gets spent in whatever order jobs happen to sit in the table, which in
 * practice meant it could burn a whole day's calls on postings for
 * "HRBP"/"Growth Management"/etc. before ever reaching a real SDE role.
 */
export async function scoreUnscoredJobsAction(): Promise<{ scored: number; remaining: number; quotaExceeded?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { scored: 0, remaining: 0 };

  const [unscored, profile] = await Promise.all([
    prisma.job.findMany({
      where: { isActive: true, jobMatches: { none: { userId: user.id } } },
      select: { id: true, title: true },
      orderBy: { firstSeenAt: "desc" },
    }),
    prisma.profile.findUnique({ where: { userId: user.id } }),
  ]);

  const keywords = deriveRelevanceKeywords([...(profile?.targetTitles ?? []), profile?.currentTitle ?? ""]);
  const prioritized = [...unscored].sort((a, b) => {
    const aRelevant = isTitleLikelyRelevant(a.title, keywords) ? 0 : 1;
    const bRelevant = isTitleLikelyRelevant(b.title, keywords) ? 0 : 1;
    return aRelevant - bRelevant;
  });
  const toScore = prioritized.slice(0, SCORE_BATCH_CAP);

  let scored = 0;
  let quotaExceeded: string | undefined;
  for (const job of toScore) {
    try {
      await runJobMatch({ userId: user.id, jobId: job.id });
      scored++;
    } catch (err) {
      if (err instanceof GeminiDailyQuotaExceededError) {
        // Retrying the remaining jobs in this batch can't succeed either —
        // stop immediately instead of repeating the same failure (each of
        // which was previously retried 6x with backoff) for every job left.
        quotaExceeded = err.message;
        break;
      }
      console.error(`Failed to score job ${job.id}:`, err);
    }
  }

  revalidatePath("/jobs");
  revalidatePath("/jobs/fresh");
  return { scored, remaining: Math.max(0, unscored.length - toScore.length), quotaExceeded };
}
