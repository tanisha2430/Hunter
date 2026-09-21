import { z } from "zod";

export const remoteTypeSchema = z.enum(["ONSITE", "HYBRID", "REMOTE", "UNKNOWN"]);
export type RemoteType = z.infer<typeof remoteTypeSchema>;

export const employmentTypeSchema = z.enum([
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "INTERNSHIP",
  "TEMPORARY",
  "UNKNOWN",
]);
export type EmploymentType = z.infer<typeof employmentTypeSchema>;
export const atsTypeSchema = z.enum([
  "GREENHOUSE",
  "LEVER",
  "ASHBY",
  "SMARTRECRUITERS",
  "GENERIC_CAREER_PAGE",
  "MANUAL_PASTE",
  "ADZUNA",
  "INDEED",
  "NAUKRI",
  "CUTSHORT",
]);
export type AtsType = z.infer<typeof atsTypeSchema>;

/**
 * DTO every JobSourceAdapter/CareerPageAdapter must emit — distinct from the
 * Prisma `Job` model. Adapters map their source-specific payload into this
 * shape via a `mapToNormalizedJob()` function; no source-specific field
 * logic should leak past that boundary. See packages/adapters.
 */
export const normalizedJobSchema = z.object({
  sourceId: z.string(),
  sourceUrl: z.string(),
  atsType: atsTypeSchema,

  title: z.string(),
  company: z.object({
    name: z.string(),
    domain: z.string().optional(),
    logoUrl: z.string().optional(),
  }),

  description: z.string(),
  requirements: z.string().optional(),
  responsibilities: z.string().optional(),
  skills: z.array(z.string()).default([]),

  experienceMin: z.number().optional(),
  experienceMax: z.number().optional(),
  salaryMin: z.number().optional(),
  salaryMax: z.number().optional(),
  currency: z.string().optional(),
  location: z.string().optional(),
  locationCountry: z.string().optional(),
  remoteType: remoteTypeSchema.default("UNKNOWN"),
  employmentType: employmentTypeSchema.default("UNKNOWN"),
  seniorityLevel: z.string().optional(),

  postedAt: z.string().optional(),
  applicationUrl: z.string(),

  rawData: z.record(z.string(), z.unknown()),
});
export type NormalizedJob = z.infer<typeof normalizedJobSchema>;

export interface AdapterCapabilities {
  search: boolean;
  details: boolean;
  apply: boolean;
  automatedApply: boolean;
}
