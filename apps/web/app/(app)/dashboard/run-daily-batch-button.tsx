"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@hunter/ui";
import { runDailyBatchNow } from "./actions";

/**
 * Manual fallback for the 6am cron job — same refresh/score/prepare
 * pipeline, triggered by hand. Runs the full company-source refresh first,
 * so this can take a few minutes on a large set of sources; the button
 * stays disabled and spinning for the whole run rather than appearing to
 * finish early.
 */
export function RunDailyBatchButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await runDailyBatchNow();
            setMessage(
              `Refreshed ${result.sourcesRefreshed}/${result.totalSources} source(s), ` +
                `scored ${result.scored} job(s)${result.quotaExceeded ? " (daily AI quota hit)" : ""}, ` +
                `prepared ${result.applicationsPrepared} application(s) for review.`,
            );
            router.refresh();
          })
        }
      >
        {pending ? "Running… (can take a few minutes)" : "Run daily batch now"}
      </Button>
      {message ? <p className="max-w-sm text-right text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
