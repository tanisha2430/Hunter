"use client";

import { useTransition } from "react";
import { Button } from "@hunter/ui";
import {
  prepareApplicationAction,
  approveApplicationAction,
  rejectApplicationAction,
  confirmManualSubmissionAction,
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
