"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@hunter/ui";
import { scanInbox } from "./actions";

export function ScanInboxButton() {
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
            try {
              const result = await scanInbox();
              setMessage(
                result.matched === 0
                  ? `Checked ${result.scanned} email(s) — no status changes found.`
                  : `Checked ${result.scanned} email(s) — updated ${result.matched}: ${result.updates
                      .map((u) => `${u.company} (${u.jobTitle}) → ${u.to.replaceAll("_", " ").toLowerCase()}`)
                      .join(", ")}`,
              );
              router.refresh();
            } catch (err) {
              setMessage(err instanceof Error ? err.message : "Failed to check inbox.");
            }
          })
        }
      >
        {pending ? "Checking inbox…" : "Check inbox for updates"}
      </Button>
      {message ? <p className="max-w-sm text-right text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
