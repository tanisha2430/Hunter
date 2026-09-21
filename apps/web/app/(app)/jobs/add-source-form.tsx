"use client";

import { useActionState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Input, Label } from "@hunter/ui";
import { addAndFetchCompanySource, type AddSourceState } from "./actions";

const initialState: AddSourceState = {};

export function AddSourceForm() {
  const [state, formAction, pending] = useActionState(addAndFetchCompanySource, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a company&apos;s job board</CardTitle>
        <CardDescription>
          Public ATS boards (Greenhouse/Lever/Ashby/SmartRecruiters) or a company&apos;s own careers page.
          Indeed/Naukri/Cutshort have no individual-facing API — adding those will show as Not Connected.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="companyName">Company name</Label>
              <Input id="companyName" name="companyName" placeholder="Acme Inc" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="atsType">Source</Label>
              <select id="atsType" name="atsType" className="h-9 rounded-md border border-border bg-surface px-3 text-sm" required>
                <option value="GREENHOUSE">Greenhouse (board token)</option>
                <option value="LEVER">Lever (site slug)</option>
                <option value="ASHBY">Ashby (job board name)</option>
                <option value="SMARTRECRUITERS">SmartRecruiters (company id)</option>
                <option value="GENERIC_CAREER_PAGE">Generic careers page (URL)</option>
                <option value="INDEED">Indeed</option>
                <option value="NAUKRI">Naukri</option>
                <option value="CUTSHORT">Cutshort</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tokenOrUrl">Token / URL</Label>
              <Input id="tokenOrUrl" name="tokenOrUrl" placeholder="acme or https://acme.com/careers" required />
            </div>
          </div>
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          {state.success ? <p className="text-sm text-success">{state.success}</p> : null}
          <Button type="submit" loading={pending} className="w-fit">
            {pending ? "Fetching…" : "Add & fetch jobs"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
