import { prisma } from "@hunter/db";
import { extractResumeText } from "./resume-parser";
import { parseResumeToStructured } from "./resume-agent";
import { validateResumeExtraction, type ValidationDrop } from "./resume-parser-validator";

export interface CreateResumeParams {
  /** Pre-generated id — the caller (apps/web) uploads the file to Storage under
   * this id before calling here, so the storagePath and DB row agree. */
  resumeId: string;
  userId: string;
  label: string;
  tags: string[];
  isPrimary: boolean;
  storagePath: string;
  fileMimeType: string;
  fileBuffer: Buffer;
}

export interface CreateResumeResult {
  resumeId: string;
  versionId: string;
  drops: ValidationDrop[];
}

/**
 * Full upload pipeline: extract text -> AI-structure it -> validate against
 * the raw text (anti-fabrication gate) -> persist Resume + its first
 * ResumeVersion. If this is marked primary, demotes any existing primary
 * resume for the user first (enforced here since Postgres partial unique
 * indexes can't do "at most one true" across an update in one statement
 * cleanly with Prisma — done as an explicit transaction instead).
 */
export async function createResume(params: CreateResumeParams): Promise<CreateResumeResult> {
  const rawText = await extractResumeText(params.fileBuffer, params.fileMimeType);
  const { data: parsed, modelUsed } = await parseResumeToStructured({
    rawText,
    userId: params.userId,
  });
  const { data: validated, drops } = validateResumeExtraction(parsed, rawText);

  const result = await prisma.$transaction(async (tx) => {
    if (params.isPrimary) {
      await tx.resume.updateMany({
        where: { userId: params.userId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const resume = await tx.resume.create({
      data: {
        id: params.resumeId,
        userId: params.userId,
        label: params.label,
        tags: params.tags,
        isPrimary: params.isPrimary,
        storagePath: params.storagePath,
        fileMimeType: params.fileMimeType,
      },
    });

    const version = await tx.resumeVersion.create({
      data: {
        resumeId: resume.id,
        versionNumber: 1,
        rawText,
        parsedData: validated,
        parseModel: modelUsed,
        parsedAt: new Date(),
      },
    });

    return { resumeId: resume.id, versionId: version.id };
  });

  return { ...result, drops };
}

export async function listResumes(userId: string) {
  return prisma.resume.findMany({
    where: { userId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
}

export async function getResumeWithLatestVersion(resumeId: string, userId: string) {
  return prisma.resume.findFirst({
    where: { id: resumeId, userId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
}

export async function setPrimaryResume(userId: string, resumeId: string): Promise<void> {
  await prisma.$transaction([
    prisma.resume.updateMany({ where: { userId, isPrimary: true }, data: { isPrimary: false } }),
    prisma.resume.update({ where: { id: resumeId }, data: { isPrimary: true } }),
  ]);
}

export async function deleteResume(userId: string, resumeId: string): Promise<void> {
  await prisma.resume.deleteMany({ where: { id: resumeId, userId } });
}
