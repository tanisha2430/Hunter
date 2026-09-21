import type { NormalizedJob } from "@hunter/core";
import type { AdapterCapabilities, JobSourceAdapter, SearchJobsParams, SearchJobsResult } from "../types";

interface SmartRecruitersPostingSummary {
  id: string;
  name: string;
  location?: { city?: string; country?: string };
  department?: { label?: string };
  releasedDate?: string;
}

interface SmartRecruitersListResponse {
  content: SmartRecruitersPostingSummary[];
}

interface SmartRecruitersPostingDetail extends SmartRecruitersPostingSummary {
  jobAd?: {
    sections?: {
      jobDescription?: { text?: string };
      qualifications?: { text?: string };
      additionalInformation?: { text?: string };
    };
  };
  customField?: Array<{ fieldLabel: string; valueLabel?: string }>;
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

function locationString(loc?: { city?: string; country?: string }): string | undefined {
  if (!loc) return undefined;
  return [loc.city, loc.country].filter(Boolean).join(", ") || undefined;
}

function mapDetailToNormalizedJob(
  detail: SmartRecruitersPostingDetail,
  companyIdentifier: string,
): NormalizedJob {
  const description = detail.jobAd?.sections?.jobDescription?.text
    ? stripHtml(detail.jobAd.sections.jobDescription.text)
    : "";
  const requirements = detail.jobAd?.sections?.qualifications?.text
    ? stripHtml(detail.jobAd.sections.qualifications.text)
    : undefined;

  const applicationUrl = `https://jobs.smartrecruiters.com/${companyIdentifier}/${detail.id}`;

  return {
    sourceId: detail.id,
    sourceUrl: applicationUrl,
    atsType: "SMARTRECRUITERS",
    title: detail.name,
    company: { name: companyIdentifier },
    description,
    requirements,
    skills: [],
    location: locationString(detail.location),
    remoteType: "UNKNOWN",
    employmentType: "UNKNOWN",
    postedAt: detail.releasedDate,
    applicationUrl,
    rawData: detail as unknown as Record<string, unknown>,
  };
}

export const smartRecruitersAdapter: JobSourceAdapter = {
  atsType: "SMARTRECRUITERS",
  capabilities: CAPABILITIES,

  async searchJobs(params: SearchJobsParams): Promise<SearchJobsResult> {
    const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(params.externalToken)}/postings`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `SmartRecruiters postings fetch failed (${res.status}) for company "${params.externalToken}"`,
      );
    }
    const json = (await res.json()) as SmartRecruitersListResponse;

    // SmartRecruiters' list endpoint only returns summaries — full detail
    // (description, qualifications) requires one detail call per posting.
    // Rate-limit-aware: fetched sequentially in small batches rather than
    // all at once.
    const jobs: NormalizedJob[] = [];
    for (const summary of json.content) {
      const detail = await this.getJobDetails(summary.id, { externalToken: params.externalToken });
      if (detail) jobs.push(detail);
    }

    return { jobs, fetchedCount: jobs.length };
  },

  async getJobDetails(externalId: string, context: { externalToken: string }): Promise<NormalizedJob | null> {
    const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(context.externalToken)}/postings/${encodeURIComponent(externalId)}`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`SmartRecruiters posting detail fetch failed (${res.status}) for id "${externalId}"`);
    }
    const detail = (await res.json()) as SmartRecruitersPostingDetail;
    return mapDetailToNormalizedJob(detail, context.externalToken);
  },
};
