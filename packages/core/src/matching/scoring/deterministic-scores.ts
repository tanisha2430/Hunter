import type { NormalizedJob } from "../../domain/job";
import type { Profile } from "@hunter/db";

export interface DimensionResult<Extra = Record<string, never>> {
  score: number; // 0-100
  extra: Extra;
}

export function scoreLocation(
  job: NormalizedJob,
  profile: Pick<Profile, "targetLocations">,
): DimensionResult<{ remoteCompatible: boolean; note?: string }> {
  if (job.remoteType === "REMOTE") {
    return { score: 100, extra: { remoteCompatible: true } };
  }
  if (!job.location || profile.targetLocations.length === 0) {
    return { score: 60, extra: { remoteCompatible: false, note: "Location unspecified — neutral score." } };
  }
  const matches = profile.targetLocations.some((loc) => job.location!.toLowerCase().includes(loc.toLowerCase()));
  if (matches) return { score: 90, extra: { remoteCompatible: false } };
  if (job.remoteType === "HYBRID") {
    return { score: 50, extra: { remoteCompatible: false, note: "Hybrid role outside your target locations." } };
  }
  return { score: 20, extra: { remoteCompatible: false, note: "Onsite role outside your target locations." } };
}

export function scoreSalary(
  job: NormalizedJob,
  profile: Pick<Profile, "desiredSalaryMin" | "desiredSalaryMax">,
): DimensionResult<{ withinRange: boolean; delta?: number }> {
  if (job.salaryMax === undefined && job.salaryMin === undefined) {
    return { score: 60, extra: { withinRange: false } }; // unknown — neutral, not penalized
  }
  if (!profile.desiredSalaryMin) {
    return { score: 80, extra: { withinRange: true } };
  }
  const jobCeiling = job.salaryMax ?? job.salaryMin!;
  if (jobCeiling >= profile.desiredSalaryMin) {
    const target = profile.desiredSalaryMax ?? profile.desiredSalaryMin;
    const score = jobCeiling >= target ? 100 : 85;
    return { score, extra: { withinRange: true, delta: jobCeiling - profile.desiredSalaryMin } };
  }
  const shortfallRatio = jobCeiling / profile.desiredSalaryMin;
  return { score: Math.max(0, Math.round(shortfallRatio * 60)), extra: { withinRange: false, delta: jobCeiling - profile.desiredSalaryMin } };
}

export function scoreExperience(
  job: NormalizedJob,
  candidateYears: number,
): DimensionResult<{ candidateYears: number; requiredMin?: number; requiredMax?: number }> {
  const extra = { candidateYears, requiredMin: job.experienceMin, requiredMax: job.experienceMax };
  if (job.experienceMin === undefined) return { score: 70, extra };

  if (candidateYears < job.experienceMin) {
    const gap = job.experienceMin - candidateYears;
    return { score: Math.max(0, Math.round(100 - gap * 25)), extra };
  }
  if (job.experienceMax !== undefined && candidateYears > job.experienceMax + 3) {
    return { score: 60, extra }; // likely overqualified
  }
  return { score: 100, extra };
}

const SENIORITY_ORDER = ["intern", "junior", "mid", "senior", "staff", "principal", "lead"];

export function scoreSeniority(
  jobLevel: string | undefined,
  candidateLevel: string | undefined,
): DimensionResult<{ candidateLevel: string; jobLevel: string }> {
  const extra = { candidateLevel: candidateLevel ?? "unknown", jobLevel: jobLevel ?? "unknown" };
  if (!jobLevel || !candidateLevel) return { score: 65, extra };

  const jobIdx = SENIORITY_ORDER.indexOf(jobLevel.toLowerCase());
  const candidateIdx = SENIORITY_ORDER.indexOf(candidateLevel.toLowerCase());
  if (jobIdx === -1 || candidateIdx === -1) return { score: 65, extra };

  const diff = Math.abs(jobIdx - candidateIdx);
  if (diff === 0) return { score: 100, extra };
  if (diff === 1) return { score: 75, extra };
  return { score: 40, extra };
}

export function scoreEducation(
  jobRequiresDegree: boolean,
  candidateHasDegree: boolean,
): DimensionResult<{ note?: string }> {
  if (!jobRequiresDegree) return { score: 100, extra: {} };
  if (candidateHasDegree) return { score: 100, extra: {} };
  return { score: 55, extra: { note: "Job may prefer a degree you haven't listed." } };
}
