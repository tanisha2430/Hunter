import type { NormalizedJob } from "@hunter/core";
import type { AdapterCapabilities, JobSourceAdapter, SearchJobsParams, SearchJobsResult } from "../types";

interface AshbyCompensationTier {
  minValue?: number;
  maxValue?: number;
  currencyCode?: string;
}

interface AshbyJob {
  id: string;
  title: string;
  department?: string;
  team?: string;
  location?: string;
  isRemote?: boolean;
  descriptionHtml?: string;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  compensation?: {
    summaryComponents?: AshbyCompensationTier[];
  };
}

interface AshbyBoardResponse {
  jobs: AshbyJob[];
}

const CAPABILITIES: AdapterCapabilities = {
  search: true,
  details: true,
  apply: false,
  automatedApply: false,
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapToNormalizedJob(job: AshbyJob, companyName: string): NormalizedJob {
  const tier = job.compensation?.summaryComponents?.[0];

  return {
    sourceId: job.id,
    sourceUrl: job.jobUrl ?? job.applyUrl ?? "",
    atsType: "ASHBY",
    title: job.title,
    company: { name: companyName },
    description: job.descriptionHtml ? stripHtml(job.descriptionHtml) : "",
    skills: [],
    location: job.location,
    remoteType: job.isRemote ? "REMOTE" : "UNKNOWN",
    employmentType: "UNKNOWN",
    // Only present when the company opted into transparent comp — otherwise
    // left undefined for the ingestion pipeline's AI-extraction backfill.
    salaryMin: tier?.minValue,
    salaryMax: tier?.maxValue,
    currency: tier?.currencyCode,
    postedAt: job.publishedAt,
    applicationUrl: job.applyUrl ?? job.jobUrl ?? "",
    rawData: job as unknown as Record<string, unknown>,
  };
}

export const ashbyAdapter: JobSourceAdapter = {
  atsType: "ASHBY",
  capabilities: CAPABILITIES,

  async searchJobs(params: SearchJobsParams): Promise<SearchJobsResult> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(params.externalToken)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Ashby job board fetch failed (${res.status}) for board "${params.externalToken}"`);
    }
    const json = (await res.json()) as AshbyBoardResponse;
    const jobs = json.jobs.map((job) => mapToNormalizedJob(job, params.externalToken));
    return { jobs, fetchedCount: jobs.length };
  },

  async getJobDetails(externalId: string, context: { externalToken: string }): Promise<NormalizedJob | null> {
    const { jobs } = await this.searchJobs({ companySourceId: "", externalToken: context.externalToken });
    return jobs.find((j) => j.sourceId === externalId) ?? null;
  },
};
