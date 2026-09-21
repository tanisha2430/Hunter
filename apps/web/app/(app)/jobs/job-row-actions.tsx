"use client";

import { useTransition } from "react";
import { Button } from "@hunter/ui";
import { runMatchForJob } from "./actions";

export function RunMatchButton({ jobId }: { jobId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      loading={pending}
      onClick={() => startTransition(() => runMatchForJob(jobId))}
    >
      {pending ? "Scoring…" : "Score match"}
    </Button>
  );
}
