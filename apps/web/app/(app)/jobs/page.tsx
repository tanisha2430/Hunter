import { listJobsForUser, deriveRelevanceKeywords, isTitleLikelyRelevant } from "@hunter/core";
import { prisma } from "@hunter/db";
import { Badge, Card, CardContent, ListGroup, ListItem, PageHeader } from "@hunter/ui";
import { getCurrentUser } from "@/lib/supabase/server";
import { AddSourceForm } from "./add-source-form";
import { PasteJobForm } from "./paste-job-form";
import { SearchAdzunaForm } from "./search-adzuna-form";
import { RunMatchButton } from "./job-row-actions";
import { CompanySourceRow } from "./company-source-row";
import { PrescreenButton } from "./prescreen-button";
import { ScoreUnscoredButton } from "./score-unscored-button";

function scoreBadgeVariant(score: number): "success" | "warning" | "default" {
  if (score >= 82) return "success";
  if (score >= 60) return "warning";
  return "default";
}

export default async function JobsPage() {
  const user = await getCurrentUser();

  const [jobs, companySources, profile, totalUnscoredCount] = await Promise.all([
    user ? listJobsForUser(user.id) : Promise.resolve([]),
    prisma.companySource.findMany({ include: { company: true }, orderBy: { createdAt: "desc" }, take: 20 }),
    user ? prisma.profile.findUnique({ where: { userId: user.id } }) : Promise.resolve(null),
    user ? prisma.job.count({ where: { isActive: true, jobMatches: { none: { userId: user.id } } } }) : Promise.resolve(0),
  ]);

  const keywords = deriveRelevanceKeywords([...(profile?.targetTitles ?? []), profile?.currentTitle ?? ""]);

  const hardRejectedJobs = jobs.filter((j) => j.jobMatches[0]?.hardRejected);
  const notHardRejected = jobs.filter((j) => !j.jobMatches[0]?.hardRejected);

  // AI-scored jobs are the strongest signal we have — always show them,
  // sorted best-first, regardless of title keywords.
  const scoredJobs = notHardRejected
    .filter((j) => j.jobMatches[0])
    .sort((a, b) => b.jobMatches[0]!.overallScore - a.jobMatches[0]!.overallScore);

  // Unscored jobs haven't been AI-checked yet (scoring costs a real API
  // call, so we can't just run it on everything) — a deterministic title
  // keyword match against your profile's target/current titles is a
  // zero-cost pre-filter so the main list isn't drowned out by every
  // department on a company's board (sales, legal, finance, design, etc.).
  const unscored = notHardRejected.filter((j) => !j.jobMatches[0]);
  const relevantUnscored = unscored.filter((j) => isTitleLikelyRelevant(j.title, keywords));
  const otherUnscored = unscored.filter((j) => !isTitleLikelyRelevant(j.title, keywords));

  function JobRow({ job }: { job: (typeof jobs)[number] }) {
    const match = job.jobMatches[0];
    return (
      <ListItem key={job.id} interactive={false}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{job.title}</span>
            {match ? <Badge variant={scoreBadgeVariant(match.overallScore)}>{match.overallScore}%</Badge> : null}
          </div>
          <span className="text-xs text-muted-foreground">
            {job.company.name || "Unknown company"} · {job.location ?? job.remoteType} · {job.employmentType}
          </span>
        </div>
        <RunMatchButton jobId={job.id} />
      </ListItem>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader title="Jobs" description="Add job sources, then score matches against your resume." />
        <div className="flex flex-wrap items-start gap-3">
          <PrescreenButton />
          <ScoreUnscoredButton unscoredCount={totalUnscoredCount} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <AddSourceForm />
        <PasteJobForm />
        {process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY ? <SearchAdzunaForm /> : null}
      </div>

      {companySources.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {companySources.map((source) => (
                <CompanySourceRow
                  key={source.id}
                  id={source.id}
                  companyName={source.company.name}
                  atsType={source.atsType}
                  status={source.lastFetchStatus}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <ListGroup>
        {scoredJobs.length === 0 && relevantUnscored.length === 0 ? (
          <ListItem interactive={false} className="text-sm text-muted-foreground">
            {jobs.length === 0
              ? "No jobs yet — add a company source or paste a job above."
              : "Nothing matching your profile's target titles yet — see \"other roles\" below, or adjust your target titles in Profile."}
          </ListItem>
        ) : (
          <>
            {scoredJobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
            {relevantUnscored.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </>
        )}
      </ListGroup>

      {otherUnscored.length > 0 ? (
        <details className="rounded-lg border border-border bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-muted-foreground">
            {otherUnscored.length} other role(s) from these companies (titles don&apos;t match your target roles) —
            click to view
          </summary>
          <div className="divide-y divide-border border-t border-border">
            {otherUnscored.map((job) => (
              <div key={job.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-foreground">{job.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {job.company.name || "Unknown company"} · {job.location ?? job.remoteType}
                  </span>
                </div>
                <RunMatchButton jobId={job.id} />
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {hardRejectedJobs.length > 0 ? (
        <details className="rounded-lg border border-border bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-muted-foreground">
            {hardRejectedJobs.length} hard-rejected job(s) — click to view why
          </summary>
          <div className="divide-y divide-border border-t border-border">
            {hardRejectedJobs.map((job) => {
              const match = job.jobMatches[0]!;
              return (
                <div key={job.id} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{job.title}</span>
                    <Badge variant="destructive">Hard rejected</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {job.company.name || "Unknown company"} · {job.location ?? job.remoteType}
                  </span>
                  <span className="text-xs text-destructive">{match.rejectionReasons.join(" ")}</span>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}
