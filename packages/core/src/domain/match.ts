import { z } from "zod";

const dimensionSchema = z.object({
  score: z.number().min(0).max(100),
  weight: z.number().min(0).max(1),
});

export const matchScoreBreakdownSchema = z.object({
  skillMatch: dimensionSchema.extend({
    matchedSkills: z.array(z.string()),
    missingSkills: z.array(z.string()),
  }),
  experienceMatch: dimensionSchema.extend({
    candidateYears: z.number(),
    requiredMin: z.number().optional(),
    requiredMax: z.number().optional(),
  }),
  roleMatch: dimensionSchema.extend({
    candidateTitle: z.string(),
    jobTitle: z.string(),
  }),
  domainMatch: dimensionSchema.extend({
    candidateDomains: z.array(z.string()),
    jobDomain: z.string().optional(),
  }),
  locationMatch: dimensionSchema.extend({
    remoteCompatible: z.boolean(),
    note: z.string().optional(),
  }),
  salaryMatch: dimensionSchema.extend({
    withinRange: z.boolean(),
    delta: z.number().optional(),
  }),
  educationMatch: dimensionSchema.extend({
    note: z.string().optional(),
  }),
  seniorityMatch: dimensionSchema.extend({
    candidateLevel: z.string(),
    jobLevel: z.string(),
  }),
  technologyMatch: dimensionSchema.extend({
    matchedTech: z.array(z.string()),
    missingTech: z.array(z.string()),
  }),
  careerGoalMatch: dimensionSchema.extend({
    note: z.string().optional(),
  }),
});
export type MatchScoreBreakdown = z.infer<typeof matchScoreBreakdownSchema>;

export interface ScoreWeights {
  skill: number;
  experience: number;
  role: number;
  domain: number;
  location: number;
  salary: number;
  education: number;
  seniority: number;
  technology: number;
  careerGoal: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  skill: 0.22,
  experience: 0.13,
  role: 0.12,
  domain: 0.08,
  location: 0.1,
  salary: 0.1,
  education: 0.05,
  seniority: 0.08,
  technology: 0.1,
  careerGoal: 0.02,
};

export const matchNarrativeSchema = z.object({
  missingSkills: z.array(z.string()),
  strongSignals: z.array(z.string()),
  concerns: z.array(z.string()),
  whyMatch: z.string(),
  whyNot: z.string(),
  recommendation: z.enum(["apply", "consider", "skip"]),
  confidence: z.number().min(0).max(1),
});
export type MatchNarrative = z.infer<typeof matchNarrativeSchema>;

export type SearchStrategy = "AGGRESSIVE" | "BALANCED" | "SELECTIVE";

export const STRATEGY_THRESHOLDS: Record<SearchStrategy, number> = {
  AGGRESSIVE: 75,
  BALANCED: 82,
  SELECTIVE: 90,
};

export function getEffectiveThreshold(settings: {
  searchStrategy: SearchStrategy;
  customThreshold?: number | null;
}): number {
  return settings.customThreshold ?? STRATEGY_THRESHOLDS[settings.searchStrategy];
}
