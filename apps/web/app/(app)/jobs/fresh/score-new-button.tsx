"use client";

import { useState, useTransition } from "react";
import { Button } from "@hunter/ui";
import { useRouter } from "next/navigation";
import { scoreNewFreshJobs } from "./actions";

export function ScoreNewJobsButton({ unscoredCount }: { unscoredCount: number }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  if (unscoredCount === 0) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await scoreNewFreshJobs();
            setMessage(
              `Scored ${result.scored} job(s)${result.remaining > 0 ? ` — ${result.remaining} more still unscored, click again` : ""}.`,
            );
            router.refresh();
          })
        }
      >
        {pending ? "Scoring…" : `Score up to 10 new (${unscoredCount} waiting)`}
      </Button>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
