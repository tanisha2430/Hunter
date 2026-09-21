import Link from "next/link";
import { prisma } from "@hunter/db";
import { getEffectiveThreshold } from "@hunter/core";
import { Badge, Card, CardContent, CardHeader, CardTitle, ListGroup, ListItem, PageHeader } from "@hunter/ui";
import { getCurrentUser } from "@/lib/supabase/server";
import { ApplyBatchForm } from "./apply-batch-form";
import { PrepareButton, ApproveRejectButtons, ConfirmManualSubmitButton, ApproveAllButton, RetryButton } from "./application-row-actions";

export default async function ApplicationsPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Applications" />
      </div>
    );
  }

  const settings = await prisma.settings.findUnique({ where: { userId: user.id } });
  const threshold = getEffectiveThreshold({
    searchStrategy: settings?.searchStrategy ?? "BALANCED",
    customThreshold: settings?.customThreshold,
  });

  const [readyToPrepare, readyForReview, awaitingManualSubmit, tracked] = await Promise.all([
    // Only genuinely confirmed matches (AI-scored, clearing the threshold) —
    // not "any non-hard-rejected match," which let low-scoring jobs (e.g.
    // 20%) show up here as if they were worth applying to.
    prisma.jobMatch.findMany({
      where: {
        userId: user.id,
        hardRejected: false,
        overallScore: { gte: threshold },
        job: { applications: { none: { userId: user.id } } },
      },
      include: { job: { include: { company: true } } },
      orderBy: { overallScore: "desc" },
      take: 20,
    }),
    prisma.application.findMany({
      where: { userId: user.id, status: "READY_FOR_REVIEW" },
      include: { job: { include: { company: true } } },
    }),
    prisma.application.findMany({
      where: { userId: user.id, status: "APPROVED" },
      include: { job: { include: { company: true } } },
    }),
    prisma.application.findMany({
      where: { userId: user.id, status: { notIn: ["DISCOVERED", "MATCHED", "SHORTLISTED", "READY_FOR_REVIEW", "APPROVED"] } },
      include: {
        job: { include: { company: true } },
        stateHistory: { orderBy: { transitionedAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Applications" description="Prepare, review, and track your applications." />

      <ApplyBatchForm />

      <Card>
        <CardHeader>
          <CardTitle>Ready to prepare</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ListGroup className="border-none">
            {readyToPrepare.length === 0 ? (
              <ListItem interactive={false} className="text-sm text-muted-foreground">
                No confirmed matches (≥{threshold}%) waiting yet — score jobs on the Jobs or Fresh Matches page first.
              </ListItem>
            ) : (
              readyToPrepare.map((match) => (
                <ListItem key={match.id} interactive={false}>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{match.job.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {match.job.company.name} · {match.overallScore}% match
                    </span>
                  </div>
                  <PrepareButton jobId={match.jobId} />
                </ListItem>
              ))
            )}
          </ListGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Approval queue ({readyForReview.length})</CardTitle>
            <ApproveAllButton count={readyForReview.length} />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ListGroup className="border-none">
            {readyForReview.length === 0 ? (
              <ListItem interactive={false} className="text-sm text-muted-foreground">
                Nothing waiting for review.
              </ListItem>
            ) : (
              readyForReview.map((app) => (
                <ListItem key={app.id} interactive={false}>
                  <div className="flex flex-col">
                    <Link href={`/applications/${app.id}`} className="text-sm font-medium hover:underline">
                      {app.job.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">{app.job.company.name}</span>
                  </div>
                  <ApproveRejectButtons applicationId={app.id} />
                </ListItem>
              ))
            )}
          </ListGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manual action required</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ListGroup className="border-none">
            {awaitingManualSubmit.length === 0 ? (
              <ListItem interactive={false} className="text-sm text-muted-foreground">
                Nothing awaiting manual submission.
              </ListItem>
            ) : (
              awaitingManualSubmit.map((app) => (
                <ListItem key={app.id} interactive={false}>
                  <div className="flex flex-col gap-1">
                    <Link href={`/applications/${app.id}`} className="text-sm font-medium hover:underline">
                      {app.job.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">{app.job.company.name}</span>
                    <Link href={`/applications/${app.id}`} className="text-xs text-primary hover:underline">
                      View tailored resume, cover letter &amp; apply →
                    </Link>
                  </div>
                  <ConfirmManualSubmitButton applicationId={app.id} />
                </ListItem>
              ))
            )}
          </ListGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tracked</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ListGroup className="border-none">
            {tracked.length === 0 ? (
              <ListItem interactive={false} className="text-sm text-muted-foreground">
                No submitted/in-progress applications yet.
              </ListItem>
            ) : (
              tracked.map((app) => {
                const isStuck = app.status === "FAILED" || app.status === "PREPARING";
                const reason = (app.stateHistory[0]?.metadata as { reason?: string } | null)?.reason;
                return (
                  <ListItem key={app.id} interactive={false}>
                    <div className="flex flex-col gap-0.5">
                      <Link href={`/applications/${app.id}`} className="text-sm font-medium hover:underline">
                        {app.job.title}
                      </Link>
                      <span className="text-xs text-muted-foreground">{app.job.company.name}</span>
                      {isStuck && reason ? <span className="text-xs text-destructive">{reason}</span> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={isStuck ? "destructive" : "outline"}>{app.status}</Badge>
                      {isStuck ? <RetryButton jobId={app.jobId} /> : null}
                    </div>
                  </ListItem>
                );
              })
            )}
          </ListGroup>
        </CardContent>
      </Card>
    </div>
  );
}
