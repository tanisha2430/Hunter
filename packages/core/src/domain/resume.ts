import { z } from "zod";

/**
 * Structured resume shape shared by ResumeVersion.parsedData and
 * TailoredResume.content. Every experience/project/bullet carries a stable
 * `id` so tailored output can cite it as a `sourceRecordId` — see
 * packages/core/src/resumes/resume-tailor-validator.ts.
 */

export const educationRecordSchema = z.object({
  id: z.string(),
  institution: z.string(),
  degree: z.string(),
  field: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  gpa: z.string().optional(),
});
export type EducationRecord = z.infer<typeof educationRecordSchema>;

export const bulletSchema = z.object({
  id: z.string(),
  text: z.string(),
  // No `.default([])` here (or anywhere else in this file): a defaulted
  // field is dropped from the JSON-Schema `required` list, and Gemini's
  // structured output takes the "minimal schema-satisfying" path — verified
  // empirically, it returned only `{contact: {...}}` when every other field
  // had a default, satisfying the schema without ever populating resume
  // content. Keeping every field a plain required array/string forces the
  // model to actually address each one.
  metrics: z.array(z.string()),
  technologies: z.array(z.string()),
});
export type Bullet = z.infer<typeof bulletSchema>;

export const experienceRecordSchema = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().nullable().optional(),
  isCurrent: z.boolean(),
  bullets: z.array(bulletSchema),
  /** Character offsets into ResumeVersion.rawText — anchors the traceability check.
   * (Plain object rather than a z.tuple(): Gemini's response_schema proto
   * rejects Zod tuples' list-style JSON-Schema `items`.) */
  rawSourceSpan: z.object({ start: z.number(), end: z.number() }).optional(),
});
export type ExperienceRecord = z.infer<typeof experienceRecordSchema>;

export const projectRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  technologies: z.array(z.string()),
  url: z.string().optional(),
});
export type ProjectRecord = z.infer<typeof projectRecordSchema>;

export const certificationRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  issuer: z.string().optional(),
  date: z.string().optional(),
});
export type CertificationRecord = z.infer<typeof certificationRecordSchema>;

export const achievementRecordSchema = z.object({
  id: z.string(),
  text: z.string(),
});
export type AchievementRecord = z.infer<typeof achievementRecordSchema>;

export const skillRecordSchema = z.object({
  name: z.string(),
  category: z.enum([
    "LANGUAGE",
    "FRAMEWORK",
    "TOOL",
    "PLATFORM",
    "DOMAIN_KNOWLEDGE",
    "SOFT_SKILL",
    "CERTIFICATION",
  ]),
});
export type SkillRecord = z.infer<typeof skillRecordSchema>;

export const resumeParsedDataSchema = z.object({
  contact: z.object({
    name: z.string(),
    email: z.string().optional(),
    phone: z.string().optional(),
    location: z.string().optional(),
    links: z.array(z.string()),
  }),
  summary: z.string().optional(),
  education: z.array(educationRecordSchema),
  experience: z.array(experienceRecordSchema),
  skills: z.array(skillRecordSchema),
  projects: z.array(projectRecordSchema),
  certifications: z.array(certificationRecordSchema),
  achievements: z.array(achievementRecordSchema),
  technologies: z.array(z.string()),
  domains: z.array(z.string()),
  metrics: z.array(z.string()),
  keywords: z.array(z.string()),
});
export type ResumeParsedData = z.infer<typeof resumeParsedDataSchema>;

// ---------- Tailoring ----------

export const tailoredBulletSchema = z.object({
  sourceBulletId: z.string(),
  renderedText: z.string(),
  emphasizedKeywords: z.array(z.string()).default([]),
});

export const tailoredSectionSchema = z.object({
  sectionType: z.enum(["experience", "project", "skills", "summary"]),
  sourceRecordId: z.string(),
  orderIndex: z.number(),
  bullets: z.array(tailoredBulletSchema),
});

export const tailoredResumePlanSchema = z.object({
  targetJobId: z.string(),
  sourceResumeId: z.string(),
  sections: z.array(tailoredSectionSchema),
  summary: z.object({
    renderedText: z.string(),
    sourceRecordIds: z.array(z.string()),
  }),
});
export type TailoredResumePlan = z.infer<typeof tailoredResumePlanSchema>;

export const resumeDiffEntrySchema = z.object({
  targetPath: z.string(),
  sourcePath: z.string().optional(),
  changeType: z.enum(["unchanged", "reworded", "reordered", "emphasized", "generated"]),
  rationale: z.string().optional(),
});
export type ResumeDiffEntry = z.infer<typeof resumeDiffEntrySchema>;
