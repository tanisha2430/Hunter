import type { NormalizedJob } from "@hunter/core";

/**
 * Adzuna (developer.adzuna.com) is a real, public, individual-facing job
 * search API — unlike Indeed/Naukri/Cutshort, which have no such thing (see
 * the stub adapters). It's fundamentally different in shape from the other
 * adapters here, though: those are each scoped to ONE company's board
 * (`JobSourceAdapter.searchJobs(companySourceId, externalToken)`); Adzuna is
 * a keyword+location search that returns postings from many different
 * companies in one call. Forcing that into the single-company adapter
 * interface would be artificial, so this is a standalone search function
 * instead — its output is still plain `NormalizedJob[]`, so it flows through
 * the exact same `ingestJobs()`/dedup/company-resolution pipeline as every
 * other source.
 *
 * Known limitation worth stating plainly: Adzuna's public API returns a
 * truncated job description (a few hundred characters), not the full
 * posting text — there's no separate "get full details" endpoint. Matching
 * quality against these postings is real but works off less text than a
 * direct ATS source (Greenhouse/Lever/etc.) would give.
 */

const CONTRACT_COUNTRY_CURRENCY: Record<string, string> = {
  in: "INR",
  gb: "GBP",
  us: "USD",
  ca: "CAD",
  au: "AUD",
};

interface AdzunaJob {
  id: string;
  title: string;
  description?: string;
  redirect_url: string;
  created?: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
  salary_min?: number;
  salary_max?: number;
  contract_time?: string; // "full_time" | "part_time"
  contract_type?: string; // "permanent" | "contract"
  category?: { label?: string; tag?: string };
}

interface AdzunaSearchResponse {
  count: number;
  results: AdzunaJob[];
}

function mapEmploymentType(job: AdzunaJob): NormalizedJob["employmentType"] {
  if (job.contract_type === "contract") return "CONTRACT";
  if (job.contract_time === "full_time") return "FULL_TIME";
  if (job.contract_time === "part_time") return "PART_TIME";
  return "UNKNOWN";
}

function mapToNormalizedJob(job: AdzunaJob, country: string): NormalizedJob {
  return {
    sourceId: job.id,
    sourceUrl: job.redirect_url,
    atsType: "ADZUNA",
    title: job.title,
    company: { name: job.company?.display_name?.trim() || "Unknown company" },
    description: job.description ?? "",
    skills: [],
    salaryMin: job.salary_min ? Math.round(job.salary_min) : undefined,
    salaryMax: job.salary_max ? Math.round(job.salary_max) : undefined,
    currency: CONTRACT_COUNTRY_CURRENCY[country],
    location: job.location?.display_name,
    locationCountry: job.location?.area?.[0],
    remoteType: "UNKNOWN", // Adzuna doesn't expose a reliable remote/hybrid/onsite signal
    employmentType: mapEmploymentType(job),
    postedAt: job.created,
    applicationUrl: job.redirect_url,
    rawData: job as unknown as Record<string, unknown>,
  };
}

export interface AdzunaSearchParams {
  appId: string;
  appKey: string;
  what: string; // keywords, e.g. "software engineer"
  where?: string; // location, e.g. "Bangalore"
  country?: string; // ISO country code Adzuna supports, e.g. "in", "gb", "us" — default "in"
  page?: number; // 1-indexed
  resultsPerPage?: number; // Adzuna caps this around 50
}

export interface AdzunaSearchResult {
  jobs: NormalizedJob[];
  totalCount: number;
}

export async function searchAdzunaJobs(params: AdzunaSearchParams): Promise<AdzunaSearchResult> {
  const country = params.country ?? "in";
  const page = params.page ?? 1;
  const resultsPerPage = Math.min(params.resultsPerPage ?? 20, 50);

  const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`);
  url.searchParams.set("app_id", params.appId);
  url.searchParams.set("app_key", params.appKey);
  url.searchParams.set("results_per_page", String(resultsPerPage));
  url.searchParams.set("what", params.what);
  if (params.where) url.searchParams.set("where", params.where);
  url.searchParams.set("content-type", "application/json");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Adzuna search failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as AdzunaSearchResponse;

  return {
    jobs: json.results.map((job) => mapToNormalizedJob(job, country)),
    totalCount: json.count,
  };
}
