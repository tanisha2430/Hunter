"use server";

import {
  getDashboardMetricDetail,
  scanInboxForApplicationUpdates,
  runDailyBatchForUser,
  type DashboardMetricKey,
  type DailyBatchResult,
} from "@hunter/core";
import { getJobSourceAdapter, genericCareerPageAdapter, AdapterNotConnectedError } from "@hunter/adapters";
import { createClient } from "@/lib/supabase/server";

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return user.id;
}

export async function getMetricDetail(metric: DashboardMetricKey) {
  const userId = await requireUserId();
  return getDashboardMetricDetail(userId, metric);
}

export async function scanInbox() {
  const userId = await requireUserId();
  return scanInboxForApplicationUpdates(userId);
}

/**
 * Manual fallback for the cron-triggered daily batch (refresh -> score ->
 * prepare) — same shared pipeline (see packages/core/src/jobs/daily-batch-
 * service.ts), same rules, just triggered by your own click through your
 * normal session instead of cron's shared-secret header. Use this if cron
 * didn't fire (machine asleep, server not running at 6am, etc.).
 */
export async function runDailyBatchNow(): Promise<DailyBatchResult> {
  const userId = await requireUserId();
  return runDailyBatchForUser(userId, {
    getJobSourceAdapter,
    genericCareerPageAdapter,
    isAdapterNotConnectedError: (err) => err instanceof AdapterNotConnectedError,
  });
}
