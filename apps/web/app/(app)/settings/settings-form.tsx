"use client";

import { useActionState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Input,
  Label,
} from "@hunter/ui";
import { saveSettings, type SettingsFormState } from "./actions";
import type { Settings } from "@hunter/db";
import type { HardRejectionRules } from "@hunter/core";

const initialState: SettingsFormState = {};

export function SettingsForm({ settings }: { settings: Settings | null }) {
  const [state, formAction, pending] = useActionState(saveSettings, initialState);
  const rules = (settings?.hardRejectionRules as unknown as HardRejectionRules | null) ?? null;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Search strategy</CardTitle>
          <CardDescription>
            Controls the match-score threshold used for &quot;highly relevant&quot; and &quot;apply to all&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="searchStrategy">Strategy</Label>
            <select
              id="searchStrategy"
              name="searchStrategy"
              defaultValue={settings?.searchStrategy ?? "BALANCED"}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
            >
              <option value="AGGRESSIVE">Aggressive (≥ 75%)</option>
              <option value="BALANCED">Balanced (≥ 82%)</option>
              <option value="SELECTIVE">Selective (≥ 90%)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customThreshold">Custom threshold override (optional)</Label>
            <Input
              id="customThreshold"
              name="customThreshold"
              type="number"
              min={0}
              max={100}
              defaultValue={settings?.customThreshold ?? ""}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hard rejection rules</CardTitle>
          <CardDescription>
            Deterministic filters applied before any AI scoring — a job failing these is never
            recommended, regardless of how good an AI opinion of it might be.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="rulesEnabled" defaultChecked={rules?.enabled ?? true} className="h-4 w-4 rounded border-border" />
            Enable hard rejection rules
          </label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="minSalary">Minimum salary</Label>
            <Input id="minSalary" name="minSalary" type="number" defaultValue={rules?.minSalary?.amount ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="currency">Currency</Label>
            <Input id="currency" name="currency" defaultValue={rules?.minSalary?.currency ?? "USD"} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="allowedLocations">Allowed locations (comma-separated)</Label>
            <Input id="allowedLocations" name="allowedLocations" defaultValue={rules?.allowedLocations?.join(", ") ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="remotePreference">Remote preference</Label>
            <select
              id="remotePreference"
              name="remotePreference"
              defaultValue={rules?.remotePreference ?? "any"}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
            >
              <option value="any">Any</option>
              <option value="remote_only">Remote only</option>
              <option value="hybrid_ok">Hybrid or remote</option>
              <option value="onsite_ok">Onsite is fine</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="requiredTechnologies">Required technologies (comma-separated)</Label>
            <Input id="requiredTechnologies" name="requiredTechnologies" defaultValue={rules?.requiredTechnologies?.join(", ") ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="requiredTechnologiesMatchMode">Match mode</Label>
            <select
              id="requiredTechnologiesMatchMode"
              name="requiredTechnologiesMatchMode"
              defaultValue={rules?.requiredTechnologiesMatchMode ?? "any"}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
            >
              <option value="any">Any of these</option>
              <option value="all">All of these</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Outreach</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dailyOutreachSendCap">Daily send cap</Label>
            <Input
              id="dailyOutreachSendCap"
              name="dailyOutreachSendCap"
              type="number"
              min={1}
              defaultValue={settings?.dailyOutreachSendCap ?? 10}
            />
          </div>
        </CardContent>
      </Card>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-success">Settings saved.</p> : null}
      <Button type="submit" loading={pending} className="w-fit">
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
