"use client";

import { useTransition } from "react";
import { Badge, Button } from "@hunter/ui";
import { removeCompanySourceAction } from "./actions";

const STATUS_LABEL: Record<string, { label: string; variant: "success" | "destructive" | "outline" | "warning" }> = {
  ok: { label: "Connected", variant: "success" },
  not_connected: { label: "Not connected", variant: "destructive" },
  blocked_by_robots: { label: "Blocked by robots.txt", variant: "destructive" },
};

function statusDisplay(status: string | null) {
  if (!status) return { label: "Fetching…", variant: "outline" as const };
  if (STATUS_LABEL[status]) return STATUS_LABEL[status];
  if (status.startsWith("error:")) return { label: "Failed to fetch", variant: "destructive" as const };
  return { label: status, variant: "outline" as const };
}

export function CompanySourceRow({
  id,
  companyName,
  atsType,
  status,
}: {
  id: string;
  companyName: string;
  atsType: string;
  status: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const display = statusDisplay(status);

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{companyName}</span>
        <span className="text-xs text-muted-foreground">{atsType}</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={display.variant}>{display.label}</Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(() => removeCompanySourceAction(id))}
        >
          {pending ? "Removing…" : "Remove"}
        </Button>
      </div>
    </div>
  );
}
