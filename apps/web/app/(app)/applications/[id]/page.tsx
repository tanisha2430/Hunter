import { notFound } from "next/navigation";
import { prisma } from "@hunter/db";
import { renderResumeAsText, type ResumeParsedData } from "@hunter/core";
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, PageHeader, Button } from "@hunter/ui";
import { getCurrentUser } from "@/lib/supabase/server";
import { ConfirmManualSubmitButton } from "../application-row-actions";
import { CopyButton } from "./copy-button";

const STATUS_LABELS: Record<string, string> = {
  DISCOVERED: "Discovered",
  MATCHED: "Matched",
  SHORTLISTED: "Shortlisted",
  PREPARING: "Preparing",
  READY_FOR_REVIEW: "Ready for review",
  APPROVED: "Approved — ready to submit",
  SUBMITTED: "Submitted",
  FAILED: "Failed to prepare",
  RECRUITER_REPLIED: "Recruiter replied",
  SCREENING: "Screening",
  INTERVIEW: "Interview",
  TECHNICAL: "Technical round",
  HR: "HR round",
  OFFER: "Offer",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) notFound();

  const application = await prisma.application.findFirst({
    where: { id, userId: user.id },
    include: {
      job: { include: { company: true } },
      tailoredResumes: { orderBy: { createdAt: "desc" }, take: 1 },
      coverLetters: { orderBy: { createdAt: "desc" }, take: 1 },
      answers: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!application) notFound();

  const tailoredResume = application.tailoredResumes[0];
  const coverLetter = application.coverLetters[0];
  const resumeText = tailoredResume ? renderResumeAsText(tailoredResume.content as unknown as ResumeParsedData) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={application.job.title}
        description={`${application.job.company.name}${application.job.location ? ` · ${application.job.location}` : ""}`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Badge>{STATUS_LABELS[application.status] ?? application.status}</Badge>
        <a href={application.job.applicationUrl} target="_blank" rel="noreferrer">
          <Button type="button" variant="outline" size="sm">
            Open application on company site →
          </Button>
        </a>
        {application.status === "APPROVED" ? (
          <ConfirmManualSubmitButton applicationId={application.id} />
        ) : null}
      </div>

      {resumeText ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Tailored resume</CardTitle>
              <div className="flex gap-2">
                <CopyButton text={resumeText} />
                <a href={`/api/applications/${application.id}/resume`} download>
                  <Button type="button" variant="outline" size="sm">
                    Download .txt
                  </Button>
                </a>
              </div>
            </div>
            <CardDescription>
              Every claim here traces back to your real base resume — nothing invented. Copy/paste or download and
              attach this to the application instead of your generic resume.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">{resumeText}</pre>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="text-sm text-muted-foreground">No tailored resume was generated for this application.</CardContent>
        </Card>
      )}

      {coverLetter ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Cover letter</CardTitle>
              <div className="flex gap-2">
                <CopyButton text={coverLetter.content} />
                <a href={`/api/applications/${application.id}/cover-letter`} download>
                  <Button type="button" variant="outline" size="sm">
                    Download .txt
                  </Button>
                </a>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">{coverLetter.content}</pre>
          </CardContent>
        </Card>
      ) : null}

      {application.answers.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Application questions</CardTitle>
            <CardDescription>
              Pre-resolved answers for common application-form questions — copy these in as you go. Anything flagged
              below still needs your input; it was never guessed.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {application.answers.map((answer) => (
              <div key={answer.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-none last:pb-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{answer.question}</span>
                  {answer.needsUserInput ? <Badge variant="warning">Needs your input</Badge> : null}
                </div>
                {answer.needsUserInput ? (
                  <p className="text-sm text-muted-foreground italic">
                    Not answered automatically — nothing reliable enough was on file for this one.
                  </p>
                ) : (
                  <p className="whitespace-pre-wrap text-sm text-foreground">{answer.answer}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
