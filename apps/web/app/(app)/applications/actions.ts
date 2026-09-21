"use server";

import { revalidatePath } from "next/cache";
import {
  prepareApplication,
  createApplyBatch,
  approveApplications,
  rejectApplications,
  confirmManualSubmission,
} from "@hunter/core";
import { prisma } from "@hunter/db";
import { createClient } from "@/lib/supabase/server";

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return user.id;
}

export async function prepareApplicationAction(jobId: string) {
  const userId = await requireUserId();
  await prepareApplication({ userId, jobId }).catch((err) => console.error("Prepare failed:", err));
  revalidatePath("/applications");
}

export interface ApplyBatchState {
  message?: string;
  error?: string;
}

export async function applyToAllAction(_prevState: ApplyBatchState, formData: FormData): Promise<ApplyBatchState> {
  const userId = await requireUserId();
  const minScore = Number(formData.get("minScore") ?? 85);
  try {
    const result = await createApplyBatch(userId, { minScore });
    revalidatePath("/applications");
    return {
      message: `${result.totalCandidates} matching job(s) ≥ ${minScore}%. Prepared ${result.preparedCount} for review (${result.needsInputCount} need more input, ${result.failedCount} failed). Nothing has been submitted — review and approve below.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Batch failed." };
  }
}

export async function approveApplicationAction(applicationId: string) {
  const userId = await requireUserId();
  await approveApplications(userId, [applicationId]);
  revalidatePath("/applications");
}

/** Approves every READY_FOR_REVIEW application in one action — same underlying `approveApplications` used for a single item, just given every pending id instead of one. */
export async function approveAllReadyAction(): Promise<{ approvedCount: number }> {
  const userId = await requireUserId();
  const pending = await prisma.application.findMany({
    where: { userId, status: "READY_FOR_REVIEW" },
    select: { id: true },
  });
  const result = await approveApplications(
    userId,
    pending.map((p) => p.id),
  );
  revalidatePath("/applications");
  return { approvedCount: result.approvedCount };
}

export async function rejectApplicationAction(applicationId: string) {
  const userId = await requireUserId();
  await rejectApplications(userId, [applicationId]);
  revalidatePath("/applications");
}

export async function confirmManualSubmissionAction(applicationId: string) {
  const userId = await requireUserId();
  await confirmManualSubmission(userId, applicationId);
  revalidatePath("/applications");
}
