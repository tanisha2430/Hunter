"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input, Button } from "@hunter/ui";
import { runCommand } from "@/app/(app)/command-actions";

export function CommandBox() {
  const [text, setText] = useState("");
  const [response, setResponse] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    if (!text.trim()) return;
    startTransition(async () => {
      const result = await runCommand(text);
      setResponse(result.message);
      setText("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-center gap-2"
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Try "apply to all jobs above 85%" or "find fintech jobs in Bangalore"'
          className="max-w-xl"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Thinking…" : "Run"}
        </Button>
      </form>
      {response ? <p className="text-xs text-muted-foreground">{response}</p> : null}
    </div>
  );
}
