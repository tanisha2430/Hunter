import { prisma, Prisma } from "@hunter/db";
import type { NormalizedJob } from "../domain/job";
import type { ResumeParsedData } from "../domain/resume";
import { DEFAULT_WEIGHTS, type MatchScoreBreakdown, type ScoreWeights } from "../domain/match";
import { evaluateHardRejectionRules, DEFAULT_HARD_REJECTION_RULES, type HardRejectionRules } from "./hard-rejection-rules";
import { scoreLocation, scoreSalary, scoreExperience, scoreSeniority, scoreEducation } from "./scoring/deterministic-scores";
import { scoreTechnology } from "./scoring/technology-score";
import { scoreJobMatchWithAI } from "./job-matching-agent";

export interface RunMatchParams {
  userId: string;
  jobId: string;
  resumeVersionId?: string;
}

export interface RunMatchResult {
  hardRejected: boolean;
  rejectionReasons: string[];
  overallScore?: number;
  jobMatchId?: string;
}

function computeOverallScore(breakdown: MatchScoreBreakdown, weights: ScoreWeights): number {
  const raw =
    breakdown.skillMatch.score * weights.skill +
    breakdown.experienceMatch.score * weights.experience +
    breakdown.roleMatch.score * weights.role +
    breakdown.domainMatch.score * weights.domain +
    breakdown.locationMatch.score * weights.location +
    breakdown.salaryMatch.score * weights.salary +
    breakdown.educationMatch.score * weights.education +
    breakdown.seniorityMatch.score * weights.seniority +
    breakdown.technologyMatch.score * weights.technology +
    breakdown.careerGoalMatch.score * weights.careerGoal;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

/**
 * Full matching pipeline for one (user, job) pair: hard-rejection filter
 * first (no AI call, cannot be overridden by AI opinion) -> deterministic
 * sub-scores -> AI-assisted sub-scores + narrative, grounded in the
 * deterministic results -> weighted composite -> persisted JobMatch.
 */
export async function runJobMatch(params: RunMatchParams): Promise<RunMatchResult> {
  const [job, profile, settings, resumeVersion] = await Promise.all([
    prisma.job.findUniqueOrThrow({ where: { id: params.jobId } }),
    prisma.profile.findUnique({ where: { userId: params.userId } }),
    prisma.settings.findUnique({ where: { userId: params.userId } }),
    params.resumeVersionId
      ? prisma.resumeVersion.findUnique({ where: { id: params.resumeVersionId } })
      : prisma.resumeVersion.findFirst({
          where: { resume: { userId: params.userId, isPrimary: true } },
          orderBy: { versionNumber: "desc" },
        }),
  ]);

  if (!profile) throw new Error("Complete your profile before running job matching.");
  if (!resumeVersion) throw new Error("Upload a resume before running job matching.");

  const resumeData = resumeVersion.parsedData as unknown as ResumeParsedData;
  const normalizedJob: NormalizedJob = {
    sourceId: job.id,
    sourceUrl: job.applicationUrl,
    atsType: "MANUAL_PASTE", // not used downstream here; job is already canonical
    title: job.title,
    company: { name: "" },
    description: job.description,
    requirements: job.requirements ?? undefined,
    responsibilities: job.responsibilities ?? undefined,
    skills: [],
    experienceMin: job.experienceMin ?? undefined,
    experienceMax: job.experienceMax ?? undefined,
    salaryMin: job.salaryMin ?? undefined,
    salaryMax: job.salaryMax ?? undefined,
    currency: job.currency ?? undefined,
    location: job.location ?? undefined,
    remoteType: job.remoteType,
    employmentType: job.employmentType,
    seniorityLevel: job.seniorityLevel ?? undefined,
    applicationUrl: job.applicationUrl,
    rawData: {},
  };

  const rules = (settings?.hardRejectionRules as unknown as HardRejectionRules) ?? DEFAULT_HARD_REJECTION_RULES;
  const rejection = evaluateHardRejectionRules(rules, {
    job: normalizedJob,
    candidateYearsExperience: profile.yearsExperience ?? undefined,
  });

  if (rejection.rejected) {
    await prisma.jobMatch.upsert({
      where: { userId_jobId_resumeVersionId: { userId: params.userId, jobId: params.jobId, resumeVersionId: resumeVersion.id } },
      create: {
        userId: params.userId,
        jobId: params.jobId,
        resumeVersionId: resumeVersion.id,
        overallScore: 0,
        scoreBreakdown: {} as Prisma.InputJsonValue,
        hardRejected: true,
        rejectionReasons: rejection.reasons,
      },
      update: { hardRejected: true, rejectionReasons: rejection.reasons, overallScore: 0 },
    });
    return { hardRejected: true, rejectionReasons: rejection.reasons };
  }

  const candidateTechnologies = [...resumeData.technologies, ...resumeData.skills.map((s) => s.name)];
  const location = scoreLocation(normalizedJob, profile);
  const salary = scoreSalary(normalizedJob, profile);
  const experience = scoreExperience(normalizedJob, profile.yearsExperience ?? 0);
  const seniority = scoreSeniority(normalizedJob.seniorityLevel, profile.currentTitle ?? undefined);
  const education = scoreEducation(/education/i.test(job.requirements ?? ""), resumeData.education.length > 0);
  const technology = scoreTechnology(normalizedJob, candidateTechnologies);

  const deterministicContext = {
    locationScore: location,
    salaryScore: salary,
    experienceScore: experience,
    seniorityScore: seniority,
    educationScore: education,
    technologyScore: technology,
  };

  const ai = await scoreJobMatchWithAI({
    job: normalizedJob,
    resume: resumeData,
    deterministicContext,
    targetTitles: profile.targetTitles,
    careerGoals: profile.careerGoals ?? undefined,
    userId: params.userId,
  });

  const weights = (settings?.matchWeights as unknown as ScoreWeights) ?? DEFAULT_WEIGHTS;

  const breakdown: MatchScoreBreakdown = {
    skillMatch: { score: ai.skillMatch.score, weight: weights.skill, matchedSkills: ai.skillMatch.matchedSkills, missingSkills: ai.skillMatch.missingSkills },
    experienceMatch: { score: experience.score, weight: weights.experience, candidateYears: profile.yearsExperience ?? 0, requiredMin: normalizedJob.experienceMin, requiredMax: normalizedJob.experienceMax },
    roleMatch: { score: ai.roleMatch.score, weight: weights.role, candidateTitle: profile.currentTitle ?? "", jobTitle: job.title },
    domainMatch: { score: ai.domainMatch.score, weight: weights.domain, candidateDomains: ai.domainMatch.candidateDomains, jobDomain: ai.domainMatch.jobDomain },
    locationMatch: { score: location.score, weight: weights.location, remoteCompatible: location.extra.remoteCompatible, note: location.extra.note },
    salaryMatch: { score: salary.score, weight: weights.salary, withinRange: salary.extra.withinRange, delta: salary.extra.delta },
    educationMatch: { score: education.score, weight: weights.education, note: education.extra.note },
    seniorityMatch: { score: seniority.score, weight: weights.seniority, candidateLevel: seniority.extra.candidateLevel, jobLevel: seniority.extra.jobLevel },
    technologyMatch: { score: technology.score, weight: weights.technology, matchedTech: technology.extra.matchedTech, missingTech: technology.extra.missingTech },
    careerGoalMatch: { score: ai.careerGoalMatch.score, weight: weights.careerGoal, note: ai.careerGoalMatch.note },
  };

  const overallScore = computeOverallScore(breakdown, weights);
  const narrative = {
    missingSkills: ai.skillMatch.missingSkills,
    strongSignals: ai.strongSignals,
    concerns: ai.concerns,
    whyMatch: ai.whyMatch,
    whyNot: ai.whyNot,
  };

  const jobMatch = await prisma.jobMatch.upsert({
    where: { userId_jobId_resumeVersionId: { userId: params.userId, jobId: params.jobId, resumeVersionId: resumeVersion.id } },
    create: {
      userId: params.userId,
      jobId: params.jobId,
      resumeVersionId: resumeVersion.id,
      overallScore,
      scoreBreakdown: { ...breakdown, narrative } as unknown as Prisma.InputJsonValue,
      matchReasoning: ai.whyMatch,
      recommendation: ai.recommendation,
      confidence: ai.confidence,
      hardRejected: false,
      rejectionReasons: [],
    },
    update: {
      overallScore,
      scoreBreakdown: { ...breakdown, narrative } as unknown as Prisma.InputJsonValue,
      matchReasoning: ai.whyMatch,
      recommendation: ai.recommendation,
      confidence: ai.confidence,
      hardRejected: false,
      rejectionReasons: [],
    },
  });

  return { hardRejected: false, rejectionReasons: [], overallScore, jobMatchId: jobMatch.id };
}
