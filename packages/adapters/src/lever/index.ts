import type { NormalizedJob, RemoteType } from "@hunter/core";
import type { AdapterCapabilities, JobSourceAdapter, SearchJobsParams, SearchJobsResult } from "../types";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt: number;
  descriptionPlain?: string;
  descriptionPlainHTML?: string;
  lists?: Array<{ text: string; content: string }>;
  categories?: {
    team?: string;
    location?: string;
    commitment?: string;
    department?: string;
  };
  workplaceType?: "remote" | "on-site" | "hybrid";
}

const CAPABILITIES: AdapterCapabilities = {
  search: true,
  details: true,
  apply: false,
  automatedApply: false,
};

function mapWorkplaceType(type?: string): RemoteType {
  switch (type) {
    case "remote":
      return "REMOTE";
    case "hybrid":
      return "HYBRID";
    case "on-site":
      return "ONSITE";
    default:
      return "UNKNOWN";
  }
}

function mapEmploymentType(commitment?: string): NormalizedJob["employmentType"] {
  const normalized = commitment?.toLowerCase() ?? "";
  if (normalized.includes("full")) return "FULL_TIME";
  if (normalized.includes("part")) return "PART_TIME";
  if (normalized.includes("contract")) return "CONTRACT";
  if (normalized.includes("intern")) return "INTERNSHIP";
  if (normalized.includes("temp")) return "TEMPORARY";
  return "UNKNOWN";
}

function mapToNormalizedJob(posting: LeverPosting, companyName: string): NormalizedJob {
  const requirements = posting.lists
    ?.filter((l) => /requirement|qualif/i.test(l.text))
    .map((l) => l.content)
    .join("\n\n");
  const responsibilities = posting.lists
    ?.filter((l) => /responsibilit/i.test(l.text))
    .map((l) => l.content)
    .join("\n\n");

  return {
    sourceId: posting.id,
    sourceUrl: posting.hostedUrl,
    atsType: "LEVER",
    title: posting.text,
    company: { name: companyName },
    description: posting.descriptionPlain ?? "",
    requirements,
    responsibilities,
    skills: [],
    location: posting.categories?.location,
    remoteType: mapWorkplaceType(posting.workplaceType),
    employmentType: mapEmploymentType(posting.categories?.commitment),
    postedAt: new Date(posting.createdAt).toISOString(),
    applicationUrl: posting.applyUrl ?? posting.hostedUrl,
    rawData: posting as unknown as Record<string, unknown>,
  };
}

export const leverAdapter: JobSourceAdapter = {
  atsType: "LEVER",
  capabilities: CAPABILITIES,

  async searchJobs(params: SearchJobsParams): Promise<SearchJobsResult> {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(params.externalToken)}?mode=json`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Lever postings fetch failed (${res.status}) for site "${params.externalToken}"`);
    }
    const postings = (await res.json()) as LeverPosting[];
    const jobs = postings.map((p) => mapToNormalizedJob(p, params.externalToken));
    return { jobs, fetchedCount: jobs.length };
  },

  async getJobDetails(externalId: string, context: { externalToken: string }): Promise<NormalizedJob | null> {
    // Lever's list endpoint already returns the full posting payload — no
    // separate detail endpoint exists, so we search and filter by id.
    const { jobs } = await this.searchJobs({ companySourceId: "", externalToken: context.externalToken });
    return jobs.find((j) => j.sourceId === externalId) ?? null;
  },
};
