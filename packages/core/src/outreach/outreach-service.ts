import { prisma } from "@hunter/db";
import { getValidAccessToken, sendGmailMessage, getGmailThreadMessageCount } from "./gmail-client";

export class NoConnectedAccountError extends Error {
  constructor() {
    super("No connected email account — connect Gmail/Outlook in Settings before sending, or copy this draft and send it yourself.");
    this.name = "NoConnectedAccountError";
  }
}

export class DailySendCapExceededError extends Error {
  constructor(cap: number) {
    super(`Daily outreach send cap (${cap}) reached — try again tomorrow, or raise the cap in Settings.`);
    this.name = "DailySendCapExceededError";
  }
}

export class RecentlyContactedError extends Error {
  constructor(days: number) {
    super(`This contact was already emailed within the last ${days} days.`);
    this.name = "RecentlyContactedError";
  }
}

export async function createOutreachDraft(params: {
  userId: string;
  campaignName: string;
  companyId?: string;
  jobId?: string;
  contactId?: string;
  subject: string;
  content: string;
}) {
  let campaign = await prisma.outreachCampaign.findFirst({
    where: { userId: params.userId, name: params.campaignName },
  });
  if (!campaign) {
    campaign = await prisma.outreachCampaign.create({
      data: { userId: params.userId, name: params.campaignName },
    });
  }

  return prisma.outreachMessage.create({
    data: {
      campaignId: campaign.id,
      companyId: params.companyId,
      jobId: params.jobId,
      contactId: params.contactId,
      subject: params.subject,
      content: params.content,
      status: "DRAFT",
    },
  });
}

const DEDUP_WINDOW_DAYS = 14;

async function assertCanSend(userId: string, contactId: string | null): Promise<void> {
  const settings = await prisma.settings.findUnique({ where: { userId } });
  const cap = settings?.dailyOutreachSendCap ?? 10;

  const sentToday = await prisma.outreachMessage.count({
    where: {
      campaign: { userId },
      status: { in: ["SENT", "REPLIED"] },
      sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  if (sentToday >= cap) throw new DailySendCapExceededError(cap);

  if (contactId) {
    const recent = await prisma.outreachMessage.findFirst({
      where: {
        contactId,
        status: { in: ["SENT", "REPLIED"] },
        sentAt: { gte: new Date(Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
      },
    });
    if (recent) throw new RecentlyContactedError(DEDUP_WINDOW_DAYS);
  }
}

/**
 * Marks a draft ready to send (explicit user action — "Generate + Review" is
 * the default mode per the product spec, so nothing reaches QUEUED without
 * this call).
 */
export async function queueMessage(userId: string, messageId: string): Promise<void> {
  await assertCanSend(userId, (await prisma.outreachMessage.findUnique({ where: { id: messageId } }))?.contactId ?? null);
  await prisma.outreachMessage.update({ where: { id: messageId }, data: { status: "QUEUED" } });
}

/**
 * Actually sends a QUEUED message via the user's connected Gmail account.
 * Requires: (1) GOOGLE_OAUTH_CLIENT_ID/SECRET configured (the app-level
 * OAuth credentials), (2) the user has connected their Gmail account
 * (ConnectedAccount row exists — see gmail-client.ts + the /api/auth/gmail
 * routes), and (3) the message has a real recipient email (via a linked
 * CompanyContact — never guessed, so a contactless/emailless draft can't be
 * sent, it must be linked to a verified contact first).
 */
export async function sendMessage(userId: string, messageId: string): Promise<void> {
  const message = await prisma.outreachMessage.findFirst({
    where: { id: messageId, campaign: { userId } },
    include: { contact: true },
  });
  if (!message || message.status !== "QUEUED") {
    throw new Error("Message must be QUEUED before it can be sent.");
  }
  if (!message.contact?.email) {
    throw new Error("This draft has no linked contact email — add a verified contact with an email before sending.");
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Gmail integration isn't configured yet (missing GOOGLE_OAUTH_CLIENT_ID/SECRET).");
  }

  const tokenInfo = await getValidAccessToken(userId, clientId, clientSecret);
  if (!tokenInfo) throw new NoConnectedAccountError();

  await assertCanSend(userId, message.contactId);

  const result = await sendGmailMessage(tokenInfo.accessToken, {
    to: message.contact.email,
    subject: message.subject ?? "",
    body: message.content,
  });

  await prisma.outreachMessage.update({
    where: { id: messageId },
    data: { status: "SENT", sentAt: new Date() },
  });
  await prisma.outreachEvent.create({
    data: { messageId, type: "sent", payload: { gmailMessageId: result.id, threadId: result.threadId } },
  });
}

export async function markManuallySent(userId: string, messageId: string): Promise<void> {
  const message = await prisma.outreachMessage.findFirst({ where: { id: messageId, campaign: { userId } } });
  if (!message) throw new Error("Message not found.");
  await prisma.outreachMessage.update({
    where: { id: messageId },
    data: { status: "SENT", sentAt: new Date() },
  });
  await prisma.outreachEvent.create({ data: { messageId, type: "sent", payload: { manual: true } } });
}

export async function listMessagesForUser(userId: string) {
  return prisma.outreachMessage.findMany({
    where: { campaign: { userId } },
    include: { contact: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Checks sent-via-Gmail outreach messages for replies, using the Gmail
 * thread each was sent on (stored in its "sent" OutreachEvent). A thread
 * that started at one message and now has more means someone replied — a
 * direct signal, not a keyword guess. Messages marked sent manually (no
 * connected-account send, so no thread on file) are skipped; there's
 * nothing to check them against.
 */
export async function scanOutreachRepliesForUser(userId: string): Promise<{ checked: number; replied: number }> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Gmail integration isn't configured (missing GOOGLE_OAUTH_CLIENT_ID/SECRET).");
  }
  const tokenInfo = await getValidAccessToken(userId, clientId, clientSecret);
  if (!tokenInfo) throw new NoConnectedAccountError();

  const sentMessages = await prisma.outreachMessage.findMany({
    where: { campaign: { userId }, status: "SENT" },
    include: { events: { where: { type: "sent" }, orderBy: { occurredAt: "desc" }, take: 1 } },
  });

  let checked = 0;
  let replied = 0;
  for (const message of sentMessages) {
    const threadId = (message.events[0]?.payload as { threadId?: string } | null)?.threadId;
    if (!threadId) continue;
    checked++;

    const messageCount = await getGmailThreadMessageCount(tokenInfo.accessToken, threadId);
    if (messageCount > 1) {
      await prisma.outreachMessage.update({
        where: { id: message.id },
        data: { status: "REPLIED", repliedAt: new Date() },
      });
      await prisma.outreachEvent.create({ data: { messageId: message.id, type: "replied", payload: { threadId } } });
      replied++;
    }
  }

  return { checked, replied };
}
