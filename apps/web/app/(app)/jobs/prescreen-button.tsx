"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@hunter/ui";
import { prescreenAllJobsAction } from "./actions";

/** Free (no-AI) bulk hard-rejection re-check — mainly useful right after changing Settings' hard-rejection rules, or as a one-off catch-up. */
export function PrescreenButton() {
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
            const result = await prescreenAllJobsAction();
            setMessage(
              `Checked ${result.checked} unscored job(s) — ${result.rejected} clearly don't match your rules, ${result.checked - result.rejected} left for AI scoring.`,
            );
            router.refresh();
          })
        }
      >
        {pending ? "Checking…" : "Clean up unscored jobs"}
      </Button>
      {message ? <p className="max-w-sm text-right text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
