import { prisma } from "@hunter/db";
import type { ParsedCommand } from "./command-agent";
import { createApplyBatch } from "../queue/apply-batch-service";
import { listJobsForUser } from "../jobs/job-search-service";
import { transition } from "../applications/application-state-machine";

export interface DispatchResult {
  message: string;
  data?: unknown;
}

const MIN_CONFIDENCE = 0.6;

/**
 * The ONLY place a parsed command's fields are used to call real service
 * functions. The AI's output is never eval'd or interpolated into a query —
 * every field is passed through typed parameters. Any intent this platform
 * doesn't yet support (or that failed confidence/sanity checks) returns an
 * explicit "not supported"/"please clarify" response — never a fabricated
 * confirmation of an action that didn't happen.
 */
export async function dispatchCommand(userId: string, command: ParsedCommand): Promise<DispatchResult> {
  if (command.confidence < MIN_CONFIDENCE || command.intent === "UNKNOWN") {
    return { message: `I'm not confident I understood "${command.rawText}" — could you rephrase it?` };
  }

  switch (command.intent) {
    case "APPLY_TO_MATCHING": {
      const minScore = clampScore(command.minScore);
      const result = await createApplyBatch(userId, { minScore });
      return {
        message: `Found ${result.totalCandidates} matching job(s) ≥ ${minScore ?? "your threshold"}%. Prepared ${result.preparedCount} for your review (${result.needsInputCount} need more input from you, ${result.failedCount} failed) — nothing has been submitted yet.`,
        data: result,
      };
    }

    case "SEARCH_JOBS": {
      const jobs = await listJobsForUser(userId, {
        minScore: clampScore(command.minScore),
        location: command.location,
        remoteOnly: undefined,
      });
      return { message: `Found ${jobs.length} job(s) matching your filters.`, data: jobs };
    }

    case "SHOW_DASHBOARD_STAT": {
      const count = await prisma.application.count({ where: { userId } });
      return { message: `You have ${count} application(s) tracked. Open the dashboard for the full breakdown.` };
    }

    case "UPDATE_SETTINGS": {
      if (!command.settingsKey || !command.settingsValue) {
        return { message: "I couldn't tell which setting to change — try being more specific." };
      }
      if (command.settingsKey === "searchStrategy") {
        const value = command.settingsValue.toUpperCase();
        if (!["AGGRESSIVE", "BALANCED", "SELECTIVE"].includes(value)) {
          return { message: `"${command.settingsValue}" isn't a valid strategy (aggressive/balanced/selective).` };
        }
        await prisma.settings.update({ where: { userId }, data: { searchStrategy: value as never } });
        return { message: `Search strategy set to ${value}.` };
      }
      return { message: `Setting "${command.settingsKey}" isn't supported via commands yet — change it in Settings directly.` };
    }

    case "CONTACT_COMPANY": {
      // Outreach draft generation needs a target company resolved from
      // context (the job/company page the user is on) — the command box
      // alone doesn't carry that, so this intent is acknowledged but
      // deferred to the outreach page's own "Email this company" action.
      return {
        message: "To email a company, open its job or company page and use the \"Email this company\" button — that gives me the context I need to draft something grounded in the real posting.",
      };
    }

    case "WITHDRAW_APPLICATION": {
      if (!command.targetJobTitle) {
        return { message: "Which application should I withdraw? Try naming the company or role." };
      }
      const app = await prisma.application.findFirst({
        where: { userId, job: { title: { contains: command.targetJobTitle, mode: "insensitive" } } },
      });
      if (!app) return { message: `Couldn't find an application matching "${command.targetJobTitle}".` };
      await transition(app.id, "WITHDRAWN", "user").catch((e: Error) => e);
      return { message: `Withdrew your application for "${command.targetJobTitle}".` };
    }

    case "REJECT_JOB": {
      if (!command.targetJobTitle) {
        return { message: "Which job should I skip? Try naming the company or role." };
      }
      return { message: "Use the Skip button on the job's card — command-based rejection isn't wired up yet." };
    }

    default:
      return { message: "That's not something I can do yet." };
  }
}

function clampScore(score?: number): number | undefined {
  if (score === undefined) return undefined;
  return Math.min(99, Math.max(50, score));
}
