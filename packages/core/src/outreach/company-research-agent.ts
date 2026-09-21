import { z } from "zod";
import { generateStructured } from "../ai/ai-client";

const researchSchema = z.object({
  relevanceSummary: z.string(),
  likelyDepartments: z.array(z.string()),
  potentialRoles: z.array(z.string()),
});
export type CompanyResearchResult = z.infer<typeof researchSchema>;

const SYSTEM_PROMPT = `You summarize why a company might be relevant to a job-seeking candidate, for
a personal job-search platform.

You are given ONLY data already stored about this company (its own description/industry, and job
postings from it already in our database) plus the candidate's profile — you have no other research
capability here, so never invent facts about the company (funding, news, culture) that aren't in the
provided data. If the provided data is thin, say so plainly rather than filling in generic-sounding
claims.`;

export async function researchCompanyRelevance(params: {
  companyName: string;
  companyDescription?: string;
  industry?: string;
  openRoleTitles: string[];
  candidateTargetTitles: string[];
  candidateDomains: string[];
  userId?: string;
}): Promise<CompanyResearchResult> {
  const { data } = await generateStructured({
    schema: researchSchema,
    system: SYSTEM_PROMPT,
    prompt: `Company: ${params.companyName}
Industry: ${params.industry ?? "(unknown)"}
Description: ${params.companyDescription ?? "(none on file)"}
Open roles we've seen from them: ${params.openRoleTitles.join(", ") || "(none)"}

Candidate's target titles: ${params.candidateTargetTitles.join(", ") || "(none specified)"}
Candidate's domain experience: ${params.candidateDomains.join(", ") || "(none specified)"}`,
    taskType: "COMPANY_RESEARCH",
    agent: "CompanyResearchAgent",
    userId: params.userId,
  });
  return data;
}
