"use server";

import { revalidatePath } from "next/cache";
import { addCompanySource, removeCompanySource, recordFetchResult, ingestJobs, runJobMatch } from "@hunter/core";
import {
  getJobSourceAdapter,
  genericCareerPageAdapter,
  fetchManualPasteShell,
  searchAdzunaJobs,
  AdapterNotConnectedError,
  RobotsDisallowedError,
} from "@hunter/adapters";
import { prisma } from "@hunter/db";
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
        await ingestJobs(jobs, user.id);
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
      await ingestJobs(jobs, user.id);
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
    await ingestJobs([shell], user.id, { useAI: true });
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
    await ingestJobs(jobs, user.id);
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

export async function runMatchForAllJobs() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const jobs = await prisma.job.findMany({ where: { isActive: true }, select: { id: true } });
  for (const job of jobs) {
    await runJobMatch({ userId: user.id, jobId: job.id }).catch((err) => console.error(err));
  }
  revalidatePath("/jobs");
}
