import { listFreshMatchedJobs, listFreshUnscoredJobs, getEffectiveThreshold } from "@hunter/core";
import { prisma } from "@hunter/db";
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, ListGroup, ListItem, PageHeader } from "@hunter/ui";
import { getCurrentUser } from "@/lib/supabase/server";
import { RefreshSourcesButton } from "./refresh-button";
import { ScoreNewJobsButton } from "./score-new-button";
import { ApplyFreshForm } from "./apply-fresh-form";
import { RunMatchButton } from "../job-row-actions";

function scoreBadgeVariant(score: number): "success" | "warning" | "default" {
  if (score >= 82) return "success";
  if (score >= 60) return "warning";
  return "default";
}

const FRESH_DAYS = 3;

export default async function FreshMatchesPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Fresh Matches" />
      </div>
    );
  }

  const settings = await prisma.settings.findUnique({ where: { userId: user.id } });
  const threshold = getEffectiveThreshold({
    searchStrategy: settings?.searchStrategy ?? "BALANCED",
    customThreshold: settings?.customThreshold,
  });

  const [matched, unscored] = await Promise.all([
    listFreshMatchedJobs(user.id, threshold, FRESH_DAYS),
    listFreshUnscoredJobs(user.id, FRESH_DAYS),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fresh Matches"
        description={`Jobs newly discovered from your added company sources in the last ${FRESH_DAYS} days.`}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
          <p className="text-sm text-muted-foreground">
            Click "Refresh sources" to check your added company sources for new postings (no AI used, but can take a
            few seconds for large boards — please wait for it to finish rather than reloading).
          </p>
          <RefreshSourcesButton />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Apply to all fresh matches</CardTitle>
          <CardDescription>Scoped to jobs newly discovered in the last {FRESH_DAYS} days only.</CardDescription>
        </CardHeader>
        <CardContent>
          <ApplyFreshForm />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Matched ({matched.length})</h2>
      </div>
      <ListGroup>
        {matched.length === 0 ? (
          <ListItem interactive={false} className="text-sm text-muted-foreground">
            No fresh jobs have scored ≥ {threshold}% yet — score the unscored jobs below, or refresh sources for new
            postings.
          </ListItem>
        ) : (
          matched.map((job) => {
            const match = job.jobMatches[0]!;
            return (
              <ListItem key={job.id} interactive={false}>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{job.title}</span>
                    <Badge variant={scoreBadgeVariant(match.overallScore)}>{match.overallScore}%</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {job.company.name} · {job.location ?? job.remoteType} · posted{" "}
                    {(job.postedAt ?? job.firstSeenAt).toLocaleDateString()}
                  </span>
                </div>
              </ListItem>
            );
          })
        )}
      </ListGroup>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Not yet scored ({unscored.length})</h2>
        <ScoreNewJobsButton unscoredCount={unscored.length} />
      </div>
      <ListGroup>
        {unscored.length === 0 ? (
          <ListItem interactive={false} className="text-sm text-muted-foreground">
            Nothing waiting to be scored. Add more company sources on the Jobs page, or click "Refresh sources" above.
          </ListItem>
        ) : (
          unscored.map((job) => (
            <ListItem key={job.id} interactive={false}>
              <div className="flex flex-col gap-1">
                <span className="font-medium text-foreground">{job.title || "(untitled posting)"}</span>
                <span className="text-xs text-muted-foreground">
                  {job.company.name} · {job.location ?? job.remoteType} · posted{" "}
                  {(job.postedAt ?? job.firstSeenAt).toLocaleDateString()}
                </span>
              </div>
              <RunMatchButton jobId={job.id} />
            </ListItem>
          ))
        )}
      </ListGroup>
    </div>
  );
}
