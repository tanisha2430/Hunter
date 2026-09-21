"use client";

import { useActionState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Input, Label } from "@hunter/ui";
import { searchAdzunaAction, type AdzunaSearchState } from "./actions";

const initialState: AdzunaSearchState = {};

export function SearchAdzunaForm() {
  const [state, formAction, pending] = useActionState(searchAdzunaAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search Adzuna</CardTitle>
        <CardDescription>
          A real public search API spanning many companies at once, not just one company&apos;s board. Descriptions
          are truncated by Adzuna itself, so matching works off less text than a direct ATS source.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="what">Keywords</Label>
              <Input id="what" name="what" placeholder="software engineer" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="where">Location (optional)</Label>
              <Input id="where" name="where" placeholder="Bangalore" />
            </div>
          </div>
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          {state.success ? <p className="text-sm text-success">{state.success}</p> : null}
          <Button type="submit" loading={pending} className="w-fit">
            {pending ? "Searching…" : "Search & import"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
