import { getDashboardStats } from "@hunter/core";
import { prisma } from "@hunter/db";
import { Card, CardContent, PageHeader } from "@hunter/ui";
import { getCurrentUser } from "@/lib/supabase/server";
import { MetricTiles, type MetricTile } from "./metric-tiles";
import { ScanInboxButton } from "./scan-inbox-button";
import { RunDailyBatchButton } from "./run-daily-batch-button";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const [stats, gmailAccount] = user
    ? await Promise.all([
        getDashboardStats(user.id),
        prisma.connectedAccount.findFirst({ where: { userId: user.id, provider: "GMAIL" } }),
      ])
    : [null, null];
  const gmailConnected = Boolean(gmailAccount);

  const tiles: MetricTile[] = stats
    ? [
        { key: "jobsFoundToday", label: "Jobs found today", value: stats.jobsFoundToday },
        { key: "highlyRelevantToday", label: "Highly relevant today", value: stats.highlyRelevantToday },
        { key: "applicationsReady", label: "Applications ready", value: stats.applicationsReady },
        { key: "applicationsSubmitted", label: "Applications submitted", value: stats.applicationsSubmitted },
        { key: "recruiterReplies", label: "Recruiter replies", value: stats.recruiterReplies },
        { key: "interviews", label: "Interviews", value: stats.interviews },
        { key: "offers", label: "Offers", value: stats.offers },
        { key: "rejections", label: "Rejections", value: stats.rejections },
        { key: "responseRate", label: "Response rate", value: `${stats.responseRate}%` },
        { key: "interviewRate", label: "Interview rate", value: `${stats.interviewRate}%` },
        { key: "offerRate", label: "Offer rate", value: `${stats.offerRate}%` },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader title="Dashboard" description="Your job search at a glance. Click a tile to see what's in it." />
        <div className="flex flex-wrap items-start gap-3">
          <RunDailyBatchButton />
          {gmailConnected ? (
            <ScanInboxButton />
          ) : (
            <p className="max-w-xs text-xs text-muted-foreground">
              Connect Gmail in <a href="/settings" className="text-primary hover:underline">Settings</a> to detect
              application replies automatically.
            </p>
          )}
        </div>
      </div>
      <MetricTiles tiles={tiles} />
      {!stats ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            Complete your <a href="/profile" className="text-primary hover:underline">profile</a> and upload a{" "}
            <a href="/resumes" className="text-primary hover:underline">resume</a> to start discovering and matching jobs.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
