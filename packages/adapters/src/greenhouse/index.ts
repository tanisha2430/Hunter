import type { NormalizedJob } from "@hunter/core";
import type { AdapterCapabilities, JobSourceAdapter, SearchJobsParams, SearchJobsResult } from "../types";

interface GreenhouseJob {
  id: number;
  title: string;
  updated_at: string;
  absolute_url: string;
  content?: string;
  location?: { name?: string };
  departments?: Array<{ name: string }>;
  offices?: Array<{ name: string }>;
  metadata?: Array<{ name: string; value: unknown }>;
}

interface GreenhouseJobsResponse {
  jobs: GreenhouseJob[];
}

const CAPABILITIES: AdapterCapabilities = {
  search: true,
  details: true,
  apply: false,
  automatedApply: false,
};

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapToNormalizedJob(job: GreenhouseJob, companyName: string): NormalizedJob {
  const description = job.content ? stripHtml(job.content) : "";
  return {
    sourceId: String(job.id),
    sourceUrl: job.absolute_url,
    atsType: "GREENHOUSE",
    title: job.title,
    company: { name: companyName },
    description,
    skills: [],
    location: job.location?.name,
    remoteType: "UNKNOWN",
    employmentType: "UNKNOWN",
    postedAt: job.updated_at,
    applicationUrl: job.absolute_url,
    // Greenhouse's public board API has no structured salary/experience
    // fields — the ingestion pipeline (packages/core) backfills these via
    // AI extraction from `description` when they're missing here.
    rawData: job as unknown as Record<string, unknown>,
  };
}

export const greenhouseAdapter: JobSourceAdapter = {
  atsType: "GREENHOUSE",
  capabilities: CAPABILITIES,

  async searchJobs(params: SearchJobsParams): Promise<SearchJobsResult> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(params.externalToken)}/jobs?content=true`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Greenhouse board fetch failed (${res.status}) for token "${params.externalToken}"`);
    }
    const json = (await res.json()) as GreenhouseJobsResponse;
    const jobs = json.jobs.map((job) => mapToNormalizedJob(job, params.externalToken));
    return { jobs, fetchedCount: jobs.length };
  },

  async getJobDetails(externalId: string, context: { externalToken: string }): Promise<NormalizedJob | null> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(context.externalToken)}/jobs/${encodeURIComponent(externalId)}?content=true`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Greenhouse job detail fetch failed (${res.status}) for id "${externalId}"`);
    }
    const job = (await res.json()) as GreenhouseJob;
    return mapToNormalizedJob(job, context.externalToken);
  },
};
