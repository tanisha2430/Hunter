"use client";

import { useActionState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Input, Label } from "@hunter/ui";
import { applyToAllAction, type ApplyBatchState } from "./actions";

const initialState: ApplyBatchState = {};

export function ApplyBatchForm() {
  const [state, formAction, pending] = useActionState(applyToAllAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Apply to all matching jobs</CardTitle>
        <CardDescription>
          Prepares a tailored resume, cover letter, and answers for every qualifying job — nothing is
          submitted until you approve each one below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="minScore">Minimum match score</Label>
            <Input id="minScore" name="minScore" type="number" min={0} max={99} defaultValue={85} className="w-32" />
          </div>
          <Button type="submit" loading={pending}>
            {pending ? "Preparing…" : "Prepare applications"}
          </Button>
        </form>
        {state.message ? <p className="mt-3 text-sm text-foreground">{state.message}</p> : null}
        {state.error ? <p className="mt-3 text-sm text-destructive">{state.error}</p> : null}
      </CardContent>
    </Card>
  );
}
