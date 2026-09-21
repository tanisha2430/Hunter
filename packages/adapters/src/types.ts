import type { AdapterCapabilities, AtsType, NormalizedJob } from "@hunter/core";

export type { AdapterCapabilities };

export interface SearchJobsParams {
  companySourceId: string;
  externalToken: string;
  since?: Date;
  cursor?: string;
}

export interface SearchJobsResult {
  jobs: NormalizedJob[];
  nextCursor?: string;
  fetchedCount: number;
}

export interface JobSourceAdapter {
  readonly atsType: AtsType;
  readonly capabilities: AdapterCapabilities;
  searchJobs(params: SearchJobsParams): Promise<SearchJobsResult>;
  getJobDetails(externalId: string, context: { externalToken: string }): Promise<NormalizedJob | null>;
}

export interface CareerPageAdapter {
  readonly atsType: "GENERIC_CAREER_PAGE";
  readonly capabilities: AdapterCapabilities;
  discoverJobs(careerPageUrl: string): Promise<NormalizedJob[]>;
}

export class AdapterNotConnectedError extends Error {
  constructor(
    public readonly source: AtsType,
    reason: string,
  ) {
    super(`${source} is not connected: ${reason}`);
    this.name = "AdapterNotConnectedError";
  }
}

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt disallows fetching ${url} — refusing to bypass.`);
    this.name = "RobotsDisallowedError";
  }
}
