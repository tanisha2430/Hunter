import { prisma, type ApplicationStatus } from "@hunter/db";
import { getEffectiveThreshold } from "../domain/match";

const INTERVIEW_STAGES = ["SCREENING", "INTERVIEW", "TECHNICAL", "HR", "OFFER"] as const;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface DashboardStats {
  jobsFoundToday: number;
  highlyRelevantToday: number;
  applicationsReady: number;
  applicationsSubmitted: number;
  recruiterReplies: number;
  interviews: number;
  offers: number;
  rejections: number;
  responseRate: number; // any state reached beyond SUBMITTED, over SUBMITTED count
  interviewRate: number;
  offerRate: number;
}

export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const today = startOfToday();
  const settings = await prisma.settings.findUnique({ where: { userId } });
  const threshold = getEffectiveThreshold({
    searchStrategy: settings?.searchStrategy ?? "BALANCED",
    customThreshold: settings?.customThreshold,
  });

  const [
    jobsFoundToday,
    highlyRelevantToday,
    applicationsReady,
    applicationsSubmitted,
    recruiterReplies,
    interviews,
    offers,
    rejections,
    everReachedInterview,
    everReachedOffer,
    everReachedAnyReply,
  ] = await Promise.all([
    prisma.job.count({ where: { firstSeenAt: { gte: today }, isExternalStub: false } }),
    prisma.jobMatch.count({ where: { userId, overallScore: { gte: threshold }, computedAt: { gte: today } } }),
    prisma.application.count({ where: { userId, status: "READY_FOR_REVIEW" } }),
    prisma.application.count({ where: { userId, status: { in: ["SUBMITTED", "RECRUITER_REPLIED", ...INTERVIEW_STAGES] } } }),
    prisma.application.count({ where: { userId, status: "RECRUITER_REPLIED" } }),
    prisma.application.count({ where: { userId, status: { in: ["INTERVIEW", "TECHNICAL", "HR"] } } }),
    prisma.application.count({ where: { userId, status: "OFFER" } }),
    prisma.application.count({ where: { userId, status: "REJECTED" } }),
    prisma.applicationStateHistory.groupBy({
      by: ["applicationId"],
      where: { toStatus: { in: [...INTERVIEW_STAGES] }, application: { userId } },
    }),
    prisma.applicationStateHistory.groupBy({
      by: ["applicationId"],
      where: { toStatus: "OFFER", application: { userId } },
    }),
    prisma.applicationStateHistory.groupBy({
      by: ["applicationId"],
      where: { toStatus: { in: ["RECRUITER_REPLIED", "SCREENING", ...INTERVIEW_STAGES] }, application: { userId } },
    }),
  ]);

  const submittedTotal = await prisma.applicationStateHistory.groupBy({
    by: ["applicationId"],
    where: { toStatus: "SUBMITTED", application: { userId } },
  });
  const submittedCount = submittedTotal.length || 1; // avoid /0

  return {
    jobsFoundToday,
    highlyRelevantToday,
    applicationsReady,
    applicationsSubmitted,
    recruiterReplies,
    interviews,
    offers,
    rejections,
    responseRate: Math.round((everReachedAnyReply.length / submittedCount) * 1000) / 10,
    interviewRate: Math.round((everReachedInterview.length / submittedCount) * 1000) / 10,
    offerRate: Math.round((everReachedOffer.length / submittedCount) * 1000) / 10,
  };
}

export type DashboardMetricKey =
  | "jobsFoundToday"
  | "highlyRelevantToday"
  | "applicationsReady"
  | "applicationsSubmitted"
  | "recruiterReplies"
  | "interviews"
  | "offers"
  | "rejections"
  | "responseRate"
  | "interviewRate"
  | "offerRate";

export interface DashboardDetailItem {
  applicationId?: string;
  jobId: string;
  company: string;
  jobTitle: string;
  status?: ApplicationStatus;
  score?: number;
  source?: "PORTAL" | "EXTERNAL";
  applicationUrl: string;
  lastStatusChangeAt?: Date;
}

const STATUS_METRIC_FILTERS: Partial<Record<DashboardMetricKey, ApplicationStatus[]>> = {
  applicationsReady: ["READY_FOR_REVIEW"],
  applicationsSubmitted: ["SUBMITTED", "RECRUITER_REPLIED", ...INTERVIEW_STAGES],
  recruiterReplies: ["RECRUITER_REPLIED"],
  interviews: ["INTERVIEW", "TECHNICAL", "HR"],
  offers: ["OFFER"],
  rejections: ["REJECTED"],
};

// "Rate" metrics count applications that EVER reached a stage, which can
// differ from applications currently sitting in it (one might have moved on
// to REJECTED afterward) — so their drawer content comes from
// ApplicationStateHistory, not the current `status` filters above.
const EVER_REACHED_METRIC_FILTERS: Partial<Record<DashboardMetricKey, ApplicationStatus[]>> = {
  responseRate: ["RECRUITER_REPLIED", "SCREENING", ...INTERVIEW_STAGES],
  interviewRate: [...INTERVIEW_STAGES],
  offerRate: ["OFFER"],
};

function applicationToDetailItem(app: {
  id: string;
  status: ApplicationStatus;
  source: "PORTAL" | "EXTERNAL";
  lastStatusChangeAt: Date;
  job: { id: string; title: string; applicationUrl: string; company: { name: string } };
}): DashboardDetailItem {
  return {
    applicationId: app.id,
    jobId: app.job.id,
    company: app.job.company.name,
    jobTitle: app.job.title,
    status: app.status,
    source: app.source,
    applicationUrl: app.job.applicationUrl,
    lastStatusChangeAt: app.lastStatusChangeAt,
  };
}

/** Drives the Dashboard's "click a metric tile to see what's in it" drawer. */
export async function getDashboardMetricDetail(
  userId: string,
  metric: DashboardMetricKey,
): Promise<DashboardDetailItem[]> {
  const today = startOfToday();

  if (metric === "jobsFoundToday") {
    const jobs = await prisma.job.findMany({
      where: { firstSeenAt: { gte: today }, isExternalStub: false },
      include: { company: true },
      orderBy: { firstSeenAt: "desc" },
      take: 200,
    });
    return jobs.map((j) => ({ jobId: j.id, company: j.company.name, jobTitle: j.title, applicationUrl: j.applicationUrl }));
  }

  if (metric === "highlyRelevantToday") {
    const settings = await prisma.settings.findUnique({ where: { userId } });
    const threshold = getEffectiveThreshold({
      searchStrategy: settings?.searchStrategy ?? "BALANCED",
      customThreshold: settings?.customThreshold,
    });
    const matches = await prisma.jobMatch.findMany({
      where: { userId, overallScore: { gte: threshold }, computedAt: { gte: today } },
      include: { job: { include: { company: true } } },
      orderBy: { overallScore: "desc" },
      take: 200,
    });
    return matches.map((m) => ({
      jobId: m.jobId,
      company: m.job.company.name,
      jobTitle: m.job.title,
      score: m.overallScore,
      applicationUrl: m.job.applicationUrl,
    }));
  }

  const statusFilter = STATUS_METRIC_FILTERS[metric];
  if (statusFilter) {
    const apps = await prisma.application.findMany({
      where: { userId, status: { in: statusFilter } },
      include: { job: { include: { company: true } } },
      orderBy: { lastStatusChangeAt: "desc" },
      take: 200,
    });
    return apps.map(applicationToDetailItem);
  }

  const everReachedFilter = EVER_REACHED_METRIC_FILTERS[metric];
  if (everReachedFilter) {
    const history = await prisma.applicationStateHistory.groupBy({
      by: ["applicationId"],
      where: { toStatus: { in: everReachedFilter }, application: { userId } },
    });
    const ids = history.map((h) => h.applicationId);
    const apps = await prisma.application.findMany({
      where: { id: { in: ids } },
      include: { job: { include: { company: true } } },
      orderBy: { lastStatusChangeAt: "desc" },
      take: 200,
    });
    return apps.map(applicationToDetailItem);
  }

  return [];
}

export async function getApplicationsBySource(userId: string) {
  const applications = await prisma.application.findMany({
    where: { userId },
    include: { job: { include: { jobSources: true } } },
  });
  const bySource = new Map<string, number>();
  for (const app of applications) {
    for (const source of app.job.jobSources) {
      bySource.set(source.atsType, (bySource.get(source.atsType) ?? 0) + 1);
    }
  }
  return Array.from(bySource.entries()).map(([source, count]) => ({ source, count }));
}

export async function getApplicationsByCompany(userId: string, limit = 10) {
  const applications = await prisma.application.findMany({
    where: { userId },
    include: { job: { include: { company: true } } },
  });
  const byCompany = new Map<string, number>();
  for (const app of applications) {
    const name = app.job.company.name;
    byCompany.set(name, (byCompany.get(name) ?? 0) + 1);
  }
  return Array.from(byCompany.entries())
    .map(([company, count]) => ({ company, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
