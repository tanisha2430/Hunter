"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@hunter/ui";
import { checkOutreachRepliesAction } from "./actions";

export function CheckRepliesButton() {
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
            const result = await checkOutreachRepliesAction();
            setMessage(
              "error" in result
                ? result.error
                : `Checked ${result.checked} sent message(s) — ${result.replied} new repl${result.replied === 1 ? "y" : "ies"}.`,
            );
            router.refresh();
          })
        }
      >
        {pending ? "Checking…" : "Check for replies"}
      </Button>
      {message ? <p className="max-w-sm text-right text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
