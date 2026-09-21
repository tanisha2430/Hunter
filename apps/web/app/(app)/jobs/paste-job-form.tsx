"use client";

import { useActionState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Input, Textarea, Label } from "@hunter/ui";
import { pasteJob, type PasteJobState } from "./actions";

const initialState: PasteJobState = {};

export function PasteJobForm() {
  const [state, formAction, pending] = useActionState(pasteJob, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Paste a job</CardTitle>
        <CardDescription>A job posting URL, or paste the description text directly.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="url">URL (optional)</Label>
            <Input id="url" name="url" placeholder="https://company.com/jobs/123" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rawText">Or paste the job description</Label>
            <Textarea id="rawText" name="rawText" rows={4} placeholder="Paste the full job posting text…" />
          </div>
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          {state.success ? <p className="text-sm text-success">{state.success}</p> : null}
          <Button type="submit" loading={pending} className="w-fit">
            {pending ? "Adding…" : "Add job"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
