"use client";

import { useActionState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Input, Label, Textarea } from "@hunter/ui";
import { saveProfile, type ProfileFormState } from "./actions";
import type { Profile } from "@hunter/db";

const initialState: ProfileFormState = {};

export function ProfileForm({ profile }: { profile: Profile | null }) {
  const [state, formAction, pending] = useActionState(saveProfile, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Personal</CardTitle>
          <CardDescription>Used to fill known application-question answers — never fabricated.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" name="fullName" defaultValue={profile?.fullName ?? ""} />
          <Field label="Headline" name="headline" defaultValue={profile?.headline ?? ""} />
          <Field label="Phone" name="phone" defaultValue={profile?.phone ?? ""} />
          <Field label="Current location" name="location" defaultValue={profile?.location ?? ""} />
          <Field label="LinkedIn URL" name="linkedinUrl" defaultValue={profile?.linkedinUrl ?? ""} />
          <Field label="GitHub URL" name="githubUrl" defaultValue={profile?.githubUrl ?? ""} />
          <Field label="Portfolio URL" name="portfolioUrl" defaultValue={profile?.portfolioUrl ?? ""} />
          <Field label="Work authorization" name="workAuthorization" defaultValue={profile?.workAuthorization ?? ""} />
          <Field
            label="Notice period (days)"
            name="noticePeriodDays"
            type="number"
            defaultValue={profile?.noticePeriodDays?.toString() ?? ""}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Professional</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Current title" name="currentTitle" defaultValue={profile?.currentTitle ?? ""} />
          <Field
            label="Years of experience"
            name="yearsExperience"
            type="number"
            step="0.5"
            defaultValue={profile?.yearsExperience?.toString() ?? ""}
          />
          <div className="sm:col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="careerGoals">Career goals</Label>
            <Textarea id="careerGoals" name="careerGoals" defaultValue={profile?.careerGoals ?? ""} rows={3} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Job preferences</CardTitle>
          <CardDescription>Comma-separated lists.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Preferred job titles"
            name="targetTitles"
            defaultValue={profile?.targetTitles?.join(", ") ?? ""}
          />
          <Field
            label="Preferred locations"
            name="targetLocations"
            defaultValue={profile?.targetLocations?.join(", ") ?? ""}
          />
          <Field
            label="Minimum salary"
            name="desiredSalaryMin"
            type="number"
            defaultValue={profile?.desiredSalaryMin?.toString() ?? ""}
          />
          <Field
            label="Target salary"
            name="desiredSalaryMax"
            type="number"
            defaultValue={profile?.desiredSalaryMax?.toString() ?? ""}
          />
          <Field label="Currency" name="desiredCurrency" defaultValue={profile?.desiredCurrency ?? "USD"} />
          <Field
            label="Companies to avoid"
            name="companiesToAvoid"
            defaultValue={profile?.companiesToAvoid?.join(", ") ?? ""}
          />
        </CardContent>
      </Card>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-success">Profile saved.</p> : null}
      <Button type="submit" loading={pending} className="w-fit">
        {pending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  step,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
  step?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} step={step} defaultValue={defaultValue} />
    </div>
  );
}
