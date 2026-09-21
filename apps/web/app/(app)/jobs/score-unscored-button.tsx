"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@hunter/ui";
import { scoreUnscoredJobsAction } from "./actions";

export function ScoreUnscoredButton({ unscoredCount }: { unscoredCount: number }) {
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
            const result = await scoreUnscoredJobsAction();
            if (result.quotaExceeded) {
              setMessage(
                `Scored ${result.scored} before hitting today's limit: ${result.quotaExceeded}`,
              );
            } else {
              setMessage(
                `Scored ${result.scored} job(s)${result.remaining > 0 ? ` — ${result.remaining} more still waiting, click again` : ""}.`,
              );
            }
            router.refresh();
          })
        }
      >
        {pending ? "Scoring…" : `Score next 10 (${unscoredCount} waiting)`}
      </Button>
      {message ? <p className="max-w-sm text-right text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
