import { prisma, type ApplicationStatus } from "@hunter/db";
import { getValidAccessToken, listRecentMessages, type GmailMessageSummary } from "./gmail-client";
import { classifyEmailIntent } from "./email-intent-agent";
import { transitionTowards } from "../applications/application-state-machine";

// Below this confidence, an AI classification is treated the same as
// UNKNOWN — a status update that's actually wrong is worse than one that
// silently doesn't happen.
const AI_CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.6;

// Statuses an inbound email could plausibly move an already-tracked
// application out of. Anything before SUBMITTED (not yet applied through the
// portal) is left alone here — a reply about a job you haven't submitted
// through this app yet is more likely a mismatch than a real signal.
// REJECTED/WITHDRAWN are terminal (excluded); OFFER can still take one more
// hop (→ WITHDRAWN) so it stays in the pool.
const MATCHABLE_STATUSES: ApplicationStatus[] = [
  "SUBMITTED",
  "RECRUITER_REPLIED",
  "SCREENING",
  "INTERVIEW",
  "TECHNICAL",
  "HR",
  "OFFER",
];

// Domains where the sender is a shared platform, not the actual employer —
// naukri/indeed/linkedin confirmation mail comes from THEIR domain even
// though the job is with a specific company. Matching a Company by this
// domain would mislabel every such email as "from Naukri". For these we
// require the employer name to come from the message's From display name
// instead, and skip creating a stub if that can't be read confidently —
// consistent with this project's rule to never fabricate a company/job.
const SHARED_JOB_PLATFORM_DOMAINS = new Set([
  "naukri.com",
  "indeed.com",
  "indeedemail.com",
  "linkedin.com",
  "cutshort.io",
  "monster.com",
  "instahyre.com",
  "wellfound.com",
  "angel.co",
  "shine.com",
  "glassdoor.com",
]);

// Generic sender-name words stripped from a display name before treating what's
// left as a candidate company name (e.g. "Acme Corp Careers" -> "Acme Corp").
const GENERIC_NAME_SUFFIXES = /\s*(careers?|recruiting|talent acquisition|talent team|hiring team|hr team|people team|jobs?|notifications?|no-?reply)\s*$/i;

type Classification = "REJECTED" | "OFFER" | "INTERVIEW" | "ACKNOWLEDGED" | "UNKNOWN";

/**
 * Deterministic (zero-AI-cost) keyword classification of an inbound email's
 * likely meaning for an application. Order matters: rejection phrasing is
 * checked first since offer/interview language ("we'd love to move forward")
 * can appear inside an otherwise-rejecting email quoting the original
 * application.
 */
function classifyEmail(subject: string, body: string): Classification {
  const text = `${subject}\n${body}`.toLowerCase();

  const rejectionPhrases = [
    "regret to inform",
    "will not be moving forward",
    "decided not to move forward",
    "not moving forward with your application",
    "pursue other candidates",
    "other candidates whose",
    "not selected for this",
    "unfortunately",
    "we have decided not to proceed",
    "will not be proceeding",
  ];
  if (rejectionPhrases.some((p) => text.includes(p))) return "REJECTED";

  const offerPhrases = [
    "pleased to offer",
    "offer of employment",
    "job offer",
    "excited to offer",
    "welcome to the team",
    "formal offer",
  ];
  if (offerPhrases.some((p) => text.includes(p))) return "OFFER";

  const interviewPhrases = [
    "schedule an interview",
    "schedule a call",
    "next round",
    "would like to invite you",
    "phone screen",
    "technical interview",
    "shortlisted",
    "move forward with your application",
    "next steps in our process",
  ];
  if (interviewPhrases.some((p) => text.includes(p))) return "INTERVIEW";

  const ackPhrases = [
    "thank you for applying",
    "thank you for your application",
    "we have received your application",
    "application received",
    "under review",
    "reviewing your application",
  ];
  if (ackPhrases.some((p) => text.includes(p))) return "ACKNOWLEDGED";

  return "UNKNOWN";
}

/** Gmail search keywords for "this looks like a job-application email" — used
 * both to build the fetch query (so personal mail is never pulled at all)
 * and, implicitly, overlaps with classifyEmail's phrase sets. */
const JOB_SIGNAL_TERMS = [
  "application",
  "applied",
  "interview",
  "recruiter",
  "recruiting",
  "hiring",
  "candidacy",
  "position",
  "offer of employment",
  "shortlisted",
  "\"thank you for applying\"",
  "\"regret to inform\"",
];

async function buildInboxQuery(userId: string): Promise<string> {
  const trackedApps = await prisma.application.findMany({
    where: { userId },
    select: { job: { select: { company: { select: { domain: true } } } } },
  });
  const domains = Array.from(
    new Set(trackedApps.map((a) => a.job.company.domain).filter((d): d is string => Boolean(d))),
  );

  const domainClause = domains.length > 0 ? `from:(${domains.map((d) => `@${d}`).join(" OR ")})` : "";
  const keywordClause = `(${JOB_SIGNAL_TERMS.join(" OR ")})`;
  const clauses = [domainClause, keywordClause].filter(Boolean);

  return `newer_than:14d -category:promotions -category:social (${clauses.join(" OR ")})`;
}

function extractSenderDomain(fromHeader: string): string | undefined {
  const match = fromHeader.match(/@([\w.-]+)/);
  return match?.[1]?.toLowerCase();
}

function extractDisplayName(fromHeader: string): string | undefined {
  const match = fromHeader.match(/^"?([^"<]+?)"?\s*<[^>]+>$/);
  const name = match?.[1]?.trim();
  return name && name.length > 0 ? name : undefined;
}

/**
 * Best-effort employer name for a job-signal email, used only when creating
 * a brand-new EXTERNAL application record. Never guesses past what the
 * message itself states — returns undefined (meaning "skip, don't fabricate
 * a company") rather than falling back to something misleading like the
 * sending platform's own name.
 */
function inferEmployerName(message: GmailMessageSummary, senderDomain: string): string | undefined {
  if (!SHARED_JOB_PLATFORM_DOMAINS.has(senderDomain)) {
    // A dedicated domain (their own ATS/mail server) is itself decent evidence
    // of the employer — still prefer the cleaned display name if present.
    const displayName = extractDisplayName(message.from);
    if (displayName) {
      const cleaned = displayName.replace(GENERIC_NAME_SUFFIXES, "").trim();
      if (cleaned.length > 1) return cleaned;
    }
    return domainToCompanyName(senderDomain);
  }

  // Shared platform domain (Naukri/Indeed/LinkedIn/...) — the sender name
  // itself is the platform, not the employer, so only a genuinely
  // employer-looking display name counts.
  const displayName = extractDisplayName(message.from);
  if (!displayName) return undefined;
  const cleaned = displayName.replace(GENERIC_NAME_SUFFIXES, "").trim();
  const looksLikePlatformName = /^(naukri|indeed|linkedin|cutshort|monster|instahyre|wellfound|angellist|shine|glassdoor)/i.test(
    cleaned,
  );
  if (cleaned.length <= 1 || looksLikePlatformName) return undefined;
  return cleaned;
}

function domainToCompanyName(domain: string): string {
  const label = domain.split(".")[0] ?? domain;
  return label
    .split(/[-_]/)
    .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function guessJobTitleFromSubject(subject: string): string {
  const cleaned = subject.replace(/^(re|fwd?):\s*/i, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : "Role (from email)";
}

const CLASSIFICATION_TO_STATUS: Record<Exclude<Classification, "UNKNOWN">, ApplicationStatus> = {
  REJECTED: "REJECTED",
  OFFER: "OFFER",
  INTERVIEW: "INTERVIEW",
  ACKNOWLEDGED: "RECRUITER_REPLIED",
};

export interface ScanResultUpdate {
  applicationId: string;
  company: string;
  jobTitle: string;
  from: ApplicationStatus;
  to: ApplicationStatus;
  isNewExternalApplication: boolean;
}

export interface ScanResult {
  scanned: number;
  matched: number;
  updates: ScanResultUpdate[];
}

/**
 * Scans the connected Gmail inbox for job-application-related email and
 * reflects it in the Dashboard: updates in-flight PORTAL applications when a
 * reply is matched, and — for job offers/rejections/interview invites from
 * companies never applied to through this app (e.g. applied directly on
 * Naukri/Indeed) — creates a lightweight EXTERNAL application record so it
 * still shows up in the same status metrics.
 *
 * Only messages that already look job-related (by Gmail query) are fetched
 * at all, and only ones that classify as a known signal are acted on —
 * nothing about unrelated personal email is inspected or stored.
 *
 * Classification is keyword-first (free, and correct for the large majority
 * of standard ATS/recruiter phrasing). Only when that's inconclusive AND the
 * email already has an identifiable target (an existing application, or a
 * confidently-named employer) does this fall back to one AI call to read the
 * actual intent — bounded that way so a single scan can't burn through a
 * whole day's AI quota, and so no AI call is spent on mail nothing could be
 * done with anyway.
 *
 * Deliberately explicit (a button the user clicks), not a background poll.
 */
export async function scanInboxForApplicationUpdates(userId: string): Promise<ScanResult> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Gmail integration isn't configured (missing GOOGLE_OAUTH_CLIENT_ID/SECRET).");
  }

  const tokenInfo = await getValidAccessToken(userId, clientId, clientSecret);
  if (!tokenInfo) {
    throw new Error("No connected Gmail account — connect it in Settings first.");
  }

  const query = await buildInboxQuery(userId);
  const messages: GmailMessageSummary[] = await listRecentMessages(tokenInfo.accessToken, query, 50);

  const result: ScanResult = { scanned: messages.length, matched: 0, updates: [] };

  for (const message of messages) {
    const senderDomain = extractSenderDomain(message.from);
    if (!senderDomain) continue;

    const isSharedPlatform = SHARED_JOB_PLATFORM_DOMAINS.has(senderDomain);

    // Look up by the sender's own domain first (only meaningful for a
    // dedicated company domain, not a shared job-board domain).
    let existingApp = isSharedPlatform
      ? null
      : await prisma.application.findFirst({
          where: { userId, status: { in: MATCHABLE_STATUSES }, job: { company: { domain: senderDomain } } },
          include: { job: { include: { company: true } } },
          orderBy: { lastStatusChangeAt: "desc" },
        });

    // Only computed when needed — used both to find a company already
    // created from a prior scan (re-queried by DB, not an in-memory cache,
    // so this dedup holds across separate button clicks) and, if none
    // exists yet, to create one.
    let employerName: string | undefined;
    let canonicalName: string | undefined;
    let domainForCompany: string | null | undefined;

    if (!existingApp) {
      employerName = inferEmployerName(message, senderDomain);
      if (employerName) {
        canonicalName = employerName.toLowerCase();
        domainForCompany = isSharedPlatform ? null : senderDomain;
        existingApp = await prisma.application.findFirst({
          where: { userId, status: { in: MATCHABLE_STATUSES }, job: { company: { canonicalName, domain: domainForCompany } } },
          include: { job: { include: { company: true } } },
          orderBy: { lastStatusChangeAt: "desc" },
        });
      }
    }

    // Nothing this email could update or attach to either way — skip before
    // spending any classification effort (keyword or AI) on it.
    if (!existingApp && !employerName) continue;

    let classification = classifyEmail(message.subject, message.bodyText);
    if (classification === "UNKNOWN") {
      try {
        const aiResult = await classifyEmailIntent({ subject: message.subject, body: message.bodyText, userId });
        if (aiResult.classification !== "UNRELATED" && aiResult.confidence >= AI_CLASSIFICATION_CONFIDENCE_THRESHOLD) {
          classification = aiResult.classification;
        }
      } catch {
        // AI fallback unavailable (quota, network, etc.) — leave it
        // unclassified rather than aborting the whole scan.
      }
    }
    if (classification === "UNKNOWN") continue;
    const targetStatus = CLASSIFICATION_TO_STATUS[classification];

    if (existingApp) {
      if (existingApp.status === targetStatus) continue;
      try {
        const fromStatus = existingApp.status;
        await transitionTowards(existingApp.id, targetStatus, "system", {
          source: "gmail_scan",
          gmailMessageId: message.id,
          subject: message.subject,
          snippet: message.snippet,
        });
        result.matched++;
        result.updates.push({
          applicationId: existingApp.id,
          company: existingApp.job.company.name,
          jobTitle: existingApp.job.title,
          from: fromStatus,
          to: targetStatus,
          isNewExternalApplication: false,
        });
      } catch {
        // No valid path from the current status (e.g. already REJECTED) —
        // skip rather than throw, one unmatched email shouldn't abort the scan.
      }
      continue;
    }

    // No existing application for this employer at all — only create a new
    // EXTERNAL record when we could name the employer with reasonable
    // confidence; never fabricate one just to have something to show.
    if (!employerName || !canonicalName || domainForCompany === undefined) continue;

    // Not a prisma.company.upsert(): Postgres unique constraints treat every
    // NULL as distinct, so a compound unique key with domain: null can't be
    // used to look up or de-duplicate domain-less (shared-platform-sourced)
    // companies — an app-level find-then-create is the only correct option.
    const company =
      (await prisma.company.findFirst({ where: { canonicalName, domain: domainForCompany } })) ??
      (await prisma.company.create({ data: { name: employerName, canonicalName, domain: domainForCompany } }));

    const jobTitle = guessJobTitleFromSubject(message.subject);
    const job = await prisma.job.create({
      data: {
        companyId: company.id,
        title: jobTitle,
        normalizedTitle: jobTitle.toLowerCase(),
        description: `Tracked automatically from an email thread. Original subject: "${message.subject}"`,
        applicationUrl: `https://mail.google.com/mail/u/0/#all/${message.threadId}`,
        isActive: false,
        isExternalStub: true,
      },
    });

    const application = await prisma.application.create({
      data: { userId, jobId: job.id, source: "EXTERNAL", status: "DISCOVERED" },
    });

    try {
      await transitionTowards(application.id, targetStatus, "system", {
        source: "gmail_scan",
        gmailMessageId: message.id,
        subject: message.subject,
        snippet: message.snippet,
      });
      result.matched++;
      result.updates.push({
        applicationId: application.id,
        company: employerName,
        jobTitle,
        from: "DISCOVERED",
        to: targetStatus,
        isNewExternalApplication: true,
      });
    } catch {
      // Leave the stub at DISCOVERED rather than losing the record entirely.
    }
  }

  return result;
}
