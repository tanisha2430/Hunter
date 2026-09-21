"use server";

import { getDashboardMetricDetail, scanInboxForApplicationUpdates, type DashboardMetricKey } from "@hunter/core";
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
