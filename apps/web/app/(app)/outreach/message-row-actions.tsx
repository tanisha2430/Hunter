"use client";

import { useState, useTransition } from "react";
import { Button } from "@hunter/ui";
import { queueMessageAction, markSentAction, sendMessageAction } from "./actions";

export function QueueButton({ messageId }: { messageId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" size="sm" loading={pending} onClick={() => startTransition(() => queueMessageAction(messageId))}>
      {pending ? "Queueing…" : "Approve to send"}
    </Button>
  );
}

/** Real send via the connected Gmail account — only shown once Gmail is connected and the message has a recipient. */
export function SendNowButton({ messageId }: { messageId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await sendMessageAction(messageId);
            setError(result.error ?? null);
          })
        }
      >
        {pending ? "Sending…" : "Send via Gmail"}
      </Button>
      {error ? <p className="max-w-56 text-right text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function MarkSentButton({ messageId }: { messageId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" size="sm" variant="outline" loading={pending} onClick={() => startTransition(() => markSentAction(messageId))}>
      {pending ? "Saving…" : "I sent this manually"}
    </Button>
  );
}
