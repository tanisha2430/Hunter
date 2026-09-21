import { listResumes } from "@hunter/core";
import { Badge, ListGroup, ListItem, PageHeader } from "@hunter/ui";
import { getCurrentUser } from "@/lib/supabase/server";
import { UploadResumeForm } from "./upload-form";
import { makePrimaryResume, removeResume } from "./actions";
import { SubmitButton } from "./submit-button";

export default async function ResumesPage() {
  const user = await getCurrentUser();
  const resumes = user ? await listResumes(user.id) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Resumes"
        description="Upload and manage the resumes the AI will tailor for each application."
      />

      <UploadResumeForm />

      <ListGroup>
        {resumes.length === 0 ? (
          <ListItem interactive={false} className="text-sm text-muted-foreground">
            No resumes yet — upload one above to get started.
          </ListItem>
        ) : (
          resumes.map((resume) => {
            const latest = resume.versions[0];
            const parsed = latest?.parsedData as { experience?: unknown[]; skills?: unknown[] } | undefined;
            return (
              <ListItem key={resume.id} interactive={false}>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{resume.label}</span>
                    {resume.isPrimary ? <Badge variant="primary">Default</Badge> : null}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {resume.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {parsed?.experience?.length ?? 0} experience entries · {parsed?.skills?.length ?? 0} skills parsed
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!resume.isPrimary ? (
                    <form action={makePrimaryResume.bind(null, resume.id)}>
                      <SubmitButton variant="outline" size="sm">
                        Make default
                      </SubmitButton>
                    </form>
                  ) : null}
                  <form action={removeResume.bind(null, resume.id)}>
                    <SubmitButton variant="ghost" size="sm">
                      Delete
                    </SubmitButton>
                  </form>
                </div>
              </ListItem>
            );
          })
        )}
      </ListGroup>
    </div>
  );
}
