"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@hunter/ui";
import { refreshAllSources } from "./actions";

export function RefreshSourcesButton() {
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
            const result = await refreshAllSources();
            setMessage(`Refreshed ${result.refreshed} source(s), found ${result.newJobs} posting(s).`);
            router.refresh();
          })
        }
      >
        {pending ? "Refreshing… (can take a while for large boards)" : "Refresh sources"}
      </Button>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
