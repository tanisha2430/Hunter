"use client";

import { useActionState, useRef } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Input, Label } from "@hunter/ui";
import { uploadResume, type UploadResumeState } from "./actions";

const initialState: UploadResumeState = {};

export function UploadResumeForm() {
  const [state, formAction, pending] = useActionState(uploadResume, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a resume</CardTitle>
        <CardDescription>PDF or DOCX, text-based (not a scanned image). We&apos;ll parse it into structured data — never inventing anything not in the file.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          action={async (formData) => {
            await formAction(formData);
            formRef.current?.reset();
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="label">Label</Label>
              <Input id="label" name="label" placeholder="Backend Resume" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Input id="tags" name="tags" placeholder="backend, fintech" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="file">File</Label>
            <Input id="file" name="file" type="file" accept=".pdf,.docx" required />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" name="isPrimary" className="h-4 w-4 rounded border-border" />
            Set as default resume
          </label>
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          {state.warning ? <p className="text-sm text-warning">{state.warning}</p> : null}
          <Button type="submit" loading={pending} className="w-fit">
            {pending ? "Parsing…" : "Upload & parse"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
