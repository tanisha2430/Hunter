"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@hunter/ui";
import {
  prepareApplicationAction,
  approveApplicationAction,
  rejectApplicationAction,
  confirmManualSubmissionAction,
  approveAllReadyAction,
} from "./actions";

function ActionButton({
  label,
  pendingLabel,
  variant,
  onRun,
}: {
  label: string;
  pendingLabel: string;
  variant?: "primary" | "outline" | "ghost" | "destructive";
  onRun: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" size="sm" variant={variant} loading={pending} onClick={() => startTransition(onRun)}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function PrepareButton({ jobId }: { jobId: string }) {
  return <ActionButton label="Prepare application" pendingLabel="Preparing…" onRun={() => prepareApplicationAction(jobId)} />;
}

export function ApproveRejectButtons({ applicationId }: { applicationId: string }) {
  return (
    <div className="flex gap-2">
      <ActionButton label="Approve" pendingLabel="Approving…" onRun={() => approveApplicationAction(applicationId)} />
      <ActionButton
        label="Reject"
        pendingLabel="Rejecting…"
        variant="ghost"
        onRun={() => rejectApplicationAction(applicationId)}
      />
    </div>
  );
}

/** Approves every currently READY_FOR_REVIEW application in one click instead of one-by-one. */
export function ApproveAllButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  if (count === 0) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await approveAllReadyAction();
            setMessage(`Approved ${result.approvedCount} application(s) — see "Manual action required" below.`);
            router.refresh();
          })
        }
      >
        {pending ? "Approving…" : `Approve all (${count})`}
      </Button>
      {message ? <p className="max-w-xs text-right text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}

/** Re-runs `prepareApplication` for a FAILED (or stuck PREPARING) application — same call as the original "Prepare", which picks up the existing row and tries again. */
export function RetryButton({ jobId }: { jobId: string }) {
  return <ActionButton label="Retry" pendingLabel="Retrying…" variant="outline" onRun={() => prepareApplicationAction(jobId)} />;
}

export function ConfirmManualSubmitButton({ applicationId }: { applicationId: string }) {
  return (
    <ActionButton
      label="I submitted this manually"
      pendingLabel="Saving…"
      variant="outline"
      onRun={() => confirmManualSubmissionAction(applicationId)}
    />
  );
}
