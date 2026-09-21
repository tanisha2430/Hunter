import { prisma } from "@hunter/db";
import type { ApplicationStatus } from "@hunter/db";

/**
 * Exact state list from the product spec. This file is the ONLY place
 * application status is allowed to change — every write path (Route
 * Handlers, batch jobs) must call `transition()`, never
 * `prisma.application.update({ data: { status } })` directly, so the
 * transition table and its audit trail can't be bypassed.
 */
export const ALLOWED_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  DISCOVERED: ["MATCHED", "REJECTED"],
  MATCHED: ["SHORTLISTED", "REJECTED"],
  SHORTLISTED: ["PREPARING", "WITHDRAWN", "REJECTED"],
  PREPARING: ["READY_FOR_REVIEW", "FAILED"],
  READY_FOR_REVIEW: ["APPROVED", "REJECTED", "WITHDRAWN"],
  APPROVED: ["SUBMITTED", "FAILED"],
  SUBMITTED: ["RECRUITER_REPLIED", "REJECTED", "WITHDRAWN"],
  FAILED: ["PREPARING"],
  RECRUITER_REPLIED: ["SCREENING", "REJECTED", "WITHDRAWN"],
  SCREENING: ["INTERVIEW", "REJECTED", "WITHDRAWN"],
  INTERVIEW: ["TECHNICAL", "HR", "OFFER", "REJECTED", "WITHDRAWN"],
  TECHNICAL: ["HR", "OFFER", "REJECTED", "WITHDRAWN"],
  HR: ["OFFER", "REJECTED", "WITHDRAWN"],
  OFFER: ["WITHDRAWN"],
  REJECTED: [],
  WITHDRAWN: [],
};

export type TransitionTrigger = "system" | "user" | "batch_approve" | "adapter_confirm";

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  constructor(from: ApplicationStatus, to: ApplicationStatus) {
    super(`Cannot transition application from ${from} to ${to}.`);
    this.name = "InvalidTransitionError";
  }
}

/**
 * Finds a valid sequence of allowed transitions from `from` to `to` (BFS
 * over ALLOWED_TRANSITIONS), or null if no path exists. Used by
 * `transitionTowards` for email-driven status updates, where a real reply
 * often skips stages the state machine models as distinct (e.g. an
 * interview invite arriving with no separate "recruiter replied" email) —
 * rather than failing outright, walk through the shortest valid path.
 */
function findTransitionPath(from: ApplicationStatus, to: ApplicationStatus): ApplicationStatus[] | null {
  if (from === to) return [];
  const queue: Array<{ state: ApplicationStatus; path: ApplicationStatus[] }> = [{ state: from, path: [] }];
  const visited = new Set<ApplicationStatus>([from]);

  while (queue.length > 0) {
    const { state, path } = queue.shift()!;
    for (const next of ALLOWED_TRANSITIONS[state]) {
      if (next === to) return [...path, next];
      if (!visited.has(next)) {
        visited.add(next);
        queue.push({ state: next, path: [...path, next] });
      }
    }
  }
  return null;
}

export class NoTransitionPathError extends Error {
  constructor(from: ApplicationStatus, to: ApplicationStatus) {
    super(`No valid path from ${from} to ${to}.`);
    this.name = "NoTransitionPathError";
  }
}

/**
 * Like `transition()`, but walks through intermediate states via
 * `findTransitionPath` when `to` isn't directly reachable from the
 * application's current status. Each hop is still recorded individually in
 * ApplicationStateHistory (marked with the same trigger/metadata), so the
 * audit trail stays honest about this being an inferred multi-step jump
 * rather than the (possibly skipped) intermediate stages actually being
 * observed.
 */
export async function transitionTowards(
  applicationId: string,
  to: ApplicationStatus,
  trigger: TransitionTrigger,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const app = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
  if (app.status === to) return; // already there, nothing to do
  const path = findTransitionPath(app.status, to);
  if (!path) throw new NoTransitionPathError(app.status, to);
  for (const step of path) {
    await transition(applicationId, step, trigger, metadata);
  }
}

export async function transition(
  applicationId: string,
  to: ApplicationStatus,
  trigger: TransitionTrigger,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const app = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
    if (!canTransition(app.status, to)) {
      throw new InvalidTransitionError(app.status, to);
    }

    await tx.application.update({
      where: { id: applicationId },
      data: { status: to, lastStatusChangeAt: new Date() },
    });

    await tx.applicationStateHistory.create({
      data: {
        applicationId,
        fromStatus: app.status,
        toStatus: to,
        trigger,
        metadata: metadata as never,
      },
    });
  });
}
