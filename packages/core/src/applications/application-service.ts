import { prisma, Prisma } from "@hunter/db";
import type { ResumeParsedData, TailoredResumePlan } from "../domain/resume";
import type { NormalizedJob } from "../domain/job";
import { generateTailoredResumePlan } from "../resumes/resume-tailor-agent";
import { validateTailoredResumePlan } from "../resumes/resume-tailor-validator";
import { generateCoverLetter, type CoverLetterStyle } from "./cover-letter-agent";
import { resolveApplicationAnswers, type ApplicationQuestion } from "./answer-resolution-service";
import { transition } from "./application-state-machine";

function jobToNormalized(job: {
  id: string;
  title: string;
  description: string;
  requirements: string | null;
  applicationUrl: string;
}): NormalizedJob {
  return {
    sourceId: job.id,
    sourceUrl: job.applicationUrl,
    atsType: "MANUAL_PASTE",
    title: job.title,
    company: { name: "" },
    description: job.description,
    requirements: job.requirements ?? undefined,
    skills: [],
    remoteType: "UNKNOWN",
    employmentType: "UNKNOWN",
    applicationUrl: job.applicationUrl,
    rawData: {},
  };
}

/**
 * Selects a base resume for a job: deterministic tag/domain matching, not
 * AI — which resume to start from is a business decision, not a semantic
 * judgment call. Falls back to the user's default resume.
 */
export async function selectResumeForJob(userId: string, jobDomainHints: string[]) {
  const resumes = await prisma.resume.findMany({
    where: { userId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  if (resumes.length === 0) return null;

  const tagged = resumes.find((r) => r.tags.some((tag) => jobDomainHints.some((hint) => tag.toLowerCase() === hint.toLowerCase())));
  return tagged ?? resumes.find((r) => r.isPrimary) ?? resumes[0]!;
}

/**
 * Ensures an Application row exists for (user, job) and advances it through
 * PREPARING: tailor resume (gated on user review before use elsewhere),
 * generate a cover letter, resolve application answers. This does NOT
 * submit anything — READY_FOR_REVIEW is as far as this goes; approval and
 * submission are explicit separate actions (see apply-batch-service.ts).
 */
export async function prepareApplication(params: {
  userId: string;
  jobId: string;
  coverLetterStyle?: CoverLetterStyle;
  questions?: ApplicationQuestion[];
}): Promise<{ applicationId: string; blockingQuestions: string[]; violations: string[] }> {
  const [job, profile, user] = await Promise.all([
    prisma.job.findUniqueOrThrow({ where: { id: params.jobId }, include: { company: true } }),
    prisma.profile.findUniqueOrThrow({ where: { userId: params.userId } }),
    prisma.user.findUniqueOrThrow({ where: { id: params.userId } }),
  ]);

  let application = await prisma.application.findUnique({
    where: { userId_jobId: { userId: params.userId, jobId: params.jobId } },
  });
  if (!application) {
    application = await prisma.application.create({
      data: { userId: params.userId, jobId: params.jobId, status: "MATCHED" },
    });
    await prisma.applicationStateHistory.create({
      data: { applicationId: application.id, toStatus: "MATCHED", trigger: "system" },
    });
  }
  if (application.status === "MATCHED" || application.status === "SHORTLISTED") {
    await transition(application.id, application.status === "MATCHED" ? "SHORTLISTED" : application.status, "user");
  }
  if (application.status !== "PREPARING") {
    await transition(application.id, "PREPARING", "user").catch(() => {
      /* already preparing/further along — fine, this call is idempotent-ish */
    });
  }

  const resume = await selectResumeForJob(params.userId, [job.company.industry ?? ""].filter(Boolean));
  if (!resume?.versions[0]) {
    await transition(application.id, "FAILED", "system", { reason: "no_resume" });
    return { applicationId: application.id, blockingQuestions: [], violations: ["No resume available to tailor."] };
  }

  const normalizedJob = jobToNormalized(job);
  const sourceResumeData = resume.versions[0].parsedData as unknown as ResumeParsedData;

  const plan: TailoredResumePlan = await generateTailoredResumePlan({
    job: normalizedJob,
    sourceResume: sourceResumeData,
    sourceResumeId: resume.id,
    userId: params.userId,
  });
  const { content, diff, violations } = validateTailoredResumePlan(plan, sourceResumeData);

  const tailoredResume = await prisma.tailoredResume.create({
    data: {
      applicationId: application.id,
      baseResumeId: resume.id,
      plan: plan as unknown as Prisma.InputJsonValue,
      content: content as unknown as Prisma.InputJsonValue,
      diffFromBase: diff as unknown as Prisma.InputJsonValue,
    },
  });

  const coverLetter = await generateCoverLetter({
    job: normalizedJob,
    companyDescription: job.company.description ?? undefined,
    candidateExperience: content.experience,
    style: params.coverLetterStyle ?? "professional",
    userId: params.userId,
  });

  const coverLetterRecord = await prisma.coverLetter.create({
    data: {
      applicationId: application.id,
      content: coverLetter.content,
      style: params.coverLetterStyle ?? "professional",
    },
  });

  const questions = params.questions ?? [];
  const answers =
    questions.length > 0
      ? await resolveApplicationAnswers({
          questions,
          userId: params.userId,
          userEmail: user.email,
          profile,
          job: normalizedJob,
          resume: content,
        })
      : [];

  for (const answer of answers) {
    await prisma.applicationAnswer.create({
      data: {
        applicationId: application.id,
        question: answer.question,
        questionType: answer.questionType,
        answer: answer.answer,
        source: answer.source,
        sourceDetail: (answer.sourceDetail ?? {}) as Prisma.InputJsonValue,
        confidence: answer.confidence,
        needsUserInput: answer.needsUserInput,
      },
    });
  }

  const blockingQuestions = answers.filter((a) => a.needsUserInput).map((a) => a.question);

  await prisma.application.update({
    where: { id: application.id },
    data: {
      resumeVersionId: resume.versions[0].id,
      manualActionRequired: blockingQuestions.length > 0,
    },
  });

  await transition(application.id, "READY_FOR_REVIEW", "system", {
    tailoredResumeId: tailoredResume.id,
    coverLetterId: coverLetterRecord.id,
    violationCount: violations.length,
  });

  return { applicationId: application.id, blockingQuestions, violations };
}
