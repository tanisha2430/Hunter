"use client";

import { useState } from "react";
import { Button } from "@hunter/ui";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard permission denied — the text is still visible/selectable on the page.
        }
      }}
    >
      {copied ? "Copied!" : "Copy"}
    </Button>
  );
}
