import type { NormalizedJob } from "@hunter/core";
import type { AdapterCapabilities, CareerPageAdapter } from "../types";
import { RobotsDisallowedError } from "../types";
import { isAllowedByRobotsTxt } from "../shared/robots";

const CAPABILITIES: AdapterCapabilities = {
  search: true, // page-list-level only
  details: false,
  apply: false,
  automatedApply: false,
};

interface JsonLdJobPosting {
  "@type"?: string;
  title?: string;
  description?: string;
  datePosted?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: { address?: { addressLocality?: string; addressCountry?: string } };
  employmentType?: string;
  url?: string;
}

function extractJsonLdJobPostings(html: string): JsonLdJobPosting[] {
  const postings: JsonLdJobPosting[] = [];
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const parsed: unknown = JSON.parse(match[1]!);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        const obj = candidate as JsonLdJobPosting;
        if (obj["@type"] === "JobPosting") postings.push(obj);
      }
    } catch {
      // malformed JSON-LD block — skip it, not a fatal error for the page
    }
  }
  return postings;
}

function mapJsonLdToNormalizedJob(posting: JsonLdJobPosting, pageUrl: string): NormalizedJob {
  const location = posting.jobLocation?.address
    ? [posting.jobLocation.address.addressLocality, posting.jobLocation.address.addressCountry]
        .filter(Boolean)
        .join(", ")
    : undefined;

  return {
    sourceId: posting.url ?? pageUrl,
    sourceUrl: posting.url ?? pageUrl,
    atsType: "GENERIC_CAREER_PAGE",
    title: posting.title ?? "Untitled role",
    company: { name: posting.hiringOrganization?.name ?? "Unknown company" },
    description: posting.description ?? "",
    skills: [],
    location,
    remoteType: "UNKNOWN",
    employmentType: "UNKNOWN",
    postedAt: posting.datePosted,
    applicationUrl: posting.url ?? pageUrl,
    rawData: posting as unknown as Record<string, unknown>,
  };
}

export class NoStructuredJobsFoundError extends Error {
  constructor(url: string) {
    super(
      `No structured job listings found on ${url} — it likely renders its job list with JavaScript ` +
        `(common for large companies using an embedded ATS widget), which a plain fetch can't see. ` +
        `Try finding the company's actual Greenhouse/Lever/Ashby/SmartRecruiters board instead (often at ` +
        `a URL like boards.greenhouse.io/<company> or jobs.lever.co/<company>), or a page that lists jobs ` +
        `as plain HTML/JSON-LD.`,
    );
    this.name = "NoStructuredJobsFoundError";
  }
}

/**
 * Best-effort discovery for a company's own careers page: JSON-LD structured
 * data only. Heuristic DOM parsing is deliberately NOT implemented (too
 * fragile/false-positive-prone across arbitrary page templates), and a
 * previous version of this adapter fell back to treating the ENTIRE
 * unparsed page as one fake "job" for a later AI-extraction pass to clean up
 * — but since bulk ingestion doesn't call AI (see job-ingestion-service.ts's
 * `useAI` option, off by default to protect quota), that fallback just
 * produced a permanently blank job (empty title/description, "UNKNOWN"
 * everywhere) for any page without JSON-LD, which is most large companies'
 * marketing-style careers landing pages. Failing honestly here — via
 * `recordFetchResult`'s error status in the caller — is more useful than a
 * fake success with a garbage job. No headless-browser bot-evasion, no
 * CAPTCHA solving — if robots.txt disallows the path, this refuses outright.
 */
export const genericCareerPageAdapter: CareerPageAdapter = {
  atsType: "GENERIC_CAREER_PAGE",
  capabilities: CAPABILITIES,

  async discoverJobs(careerPageUrl: string): Promise<NormalizedJob[]> {
    const allowed = await isAllowedByRobotsTxt(careerPageUrl);
    if (!allowed) {
      throw new RobotsDisallowedError(careerPageUrl);
    }

    const res = await fetch(careerPageUrl, {
      headers: { "User-Agent": "AIJobHunter/1.0 (+personal job search assistant)" },
    });
    if (!res.ok) {
      throw new Error(`Career page fetch failed (${res.status}) for ${careerPageUrl}`);
    }
    const html = await res.text();

    const jsonLdPostings = extractJsonLdJobPostings(html);
    if (jsonLdPostings.length === 0) {
      throw new NoStructuredJobsFoundError(careerPageUrl);
    }
    return jsonLdPostings.map((p) => mapJsonLdToNormalizedJob(p, careerPageUrl));
  },
};
