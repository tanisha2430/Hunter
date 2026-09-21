import { z } from "zod";
import { prisma } from "@hunter/db";

export const profileInputSchema = z.object({
  fullName: z.string().min(1).optional(),
  headline: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  linkedinUrl: z.string().url().optional().or(z.literal("")),
  githubUrl: z.string().url().optional().or(z.literal("")),
  portfolioUrl: z.string().url().optional().or(z.literal("")),
  yearsExperience: z.coerce.number().min(0).max(60).optional(),
  currentTitle: z.string().optional(),
  workAuthorization: z.string().optional(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
  targetTitles: z.array(z.string()).default([]),
  targetLocations: z.array(z.string()).default([]),
  desiredSalaryMin: z.coerce.number().int().min(0).optional(),
  desiredSalaryMax: z.coerce.number().int().min(0).optional(),
  desiredCurrency: z.string().default("USD"),
  careerGoals: z.string().optional(),
  companiesToAvoid: z.array(z.string()).default([]),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export async function getProfile(userId: string) {
  return prisma.profile.findUnique({ where: { userId } });
}

export async function upsertProfile(userId: string, input: ProfileInput) {
  const data = {
    ...input,
    linkedinUrl: input.linkedinUrl || null,
    githubUrl: input.githubUrl || null,
    portfolioUrl: input.portfolioUrl || null,
  };

  return prisma.profile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}
