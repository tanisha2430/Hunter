"use client";

import { useActionState } from "react";
import { Button, Input, Label } from "@hunter/ui";
import { applyToFreshMatches, type ApplyFreshState } from "./actions";

const initialState: ApplyFreshState = {};

export function ApplyFreshForm() {
  const [state, formAction, pending] = useActionState(applyToFreshMatches, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="minScore">Minimum match score</Label>
        <Input id="minScore" name="minScore" type="number" min={50} max={99} defaultValue={85} className="w-32" />
      </div>
      <Button type="submit" loading={pending}>
        {pending ? "Preparing…" : "Prepare applications"}
      </Button>
      {state.message ? <p className="text-sm text-foreground">{state.message}</p> : null}
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
