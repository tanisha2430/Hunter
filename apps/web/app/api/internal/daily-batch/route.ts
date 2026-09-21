import { NextResponse } from "next/server";
import { runDailyBatchForUser } from "@hunter/core";
import { getJobSourceAdapter, genericCareerPageAdapter, AdapterNotConnectedError } from "@hunter/adapters";
import { prisma } from "@hunter/db";

/**
 * Unattended daily pipeline, cron-triggered. See
 * packages/core/src/jobs/daily-batch-service.ts for what it actually does —
 * this route is just the cron-facing entry point (secret-header auth
 * instead of a session, since cron has no browser to authenticate with; see
 * proxy.ts for the matching middleware exclusion). The manual "Run now"
 * button on the Dashboard calls the same shared function through a normal
 * session-authenticated Server Action instead of this route.
 */
export async function GET(request: Request) {
  const secret = process.env.DAILY_BATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "DAILY_BATCH_SECRET is not configured — refusing to run." }, { status: 500 });
  }
  if (request.headers.get("x-batch-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const user = await prisma.user.findFirst();
  if (!user) return NextResponse.json({ error: "No user found." }, { status: 500 });

  const result = await runDailyBatchForUser(user.id, {
    getJobSourceAdapter,
    genericCareerPageAdapter,
    isAdapterNotConnectedError: (err) => err instanceof AdapterNotConnectedError,
  });

  return NextResponse.json(result);
}
