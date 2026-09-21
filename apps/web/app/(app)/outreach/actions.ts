"use server";

import { revalidatePath } from "next/cache";
import {
  addManualContact,
  generateColdEmail,
  createOutreachDraft,
  queueMessage,
  markManuallySent,
  sendMessage,
  scanOutreachRepliesForUser,
  suggestPatternContacts,
  saveSuggestedContact,
} from "@hunter/core";
import { prisma } from "@hunter/db";
import { getCurrentUser } from "@/lib/supabase/server";

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  return user;
}

export interface AddContactState {
  error?: string;
  success?: boolean;
}

export async function addContactAction(_prevState: AddContactState, formData: FormData): Promise<AddContactState> {
  await requireUser();
  const companyId = String(formData.get("companyId") ?? "");
  if (!companyId) return { error: "Choose a company." };

  await addManualContact({
    companyId,
    fullName: String(formData.get("fullName") ?? "") || undefined,
    title: String(formData.get("title") ?? "") || undefined,
    email: String(formData.get("email") ?? "") || undefined,
    linkedinUrl: String(formData.get("linkedinUrl") ?? "") || undefined,
    role: String(formData.get("role") ?? "") || undefined,
    verified: formData.get("verified") === "on",
  });

  revalidatePath("/outreach");
  return { success: true };
}

export interface DraftEmailState {
  error?: string;
  success?: boolean;
}

export async function draftColdEmailAction(_prevState: DraftEmailState, formData: FormData): Promise<DraftEmailState> {
  const user = await requireUser();
  const companyId = String(formData.get("companyId") ?? "");
  const contactId = String(formData.get("contactId") ?? "") || undefined;
  if (!companyId) return { error: "Choose a company." };

  const [company, resume] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
    prisma.resume.findFirst({
      where: { userId: user.id, isPrimary: true },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    }),
  ]);

  if (!resume?.versions[0]) return { error: "Upload and set a default resume first." };

  const resumeData = resume.versions[0].parsedData as unknown as { experience: unknown[]; contact: { name: string } };

  try {
    const email = await generateColdEmail({
      companyName: company.name,
      companyContext: company.description ?? undefined,
      candidateExperience: resumeData.experience as never,
      userId: user.id,
    });

    await createOutreachDraft({
      userId: user.id,
      campaignName: "General outreach",
      companyId,
      contactId,
      subject: email.subject,
      content: email.body,
    });

    revalidatePath("/outreach");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to draft email." };
  }
}

/** Creates a draft entirely from what the user typed — no AI call, no generated content. */
export async function createManualDraftAction(_prevState: DraftEmailState, formData: FormData): Promise<DraftEmailState> {
  const user = await requireUser();
  const companyId = String(formData.get("companyId") ?? "");
  const contactId = String(formData.get("contactId") ?? "") || undefined;
  const subject = String(formData.get("subject") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!companyId) return { error: "Choose a company." };
  if (!subject) return { error: "Give it a subject." };
  if (!content) return { error: "Write the email body." };

  await createOutreachDraft({
    userId: user.id,
    campaignName: "General outreach",
    companyId,
    contactId,
    subject,
    content,
  });

  revalidatePath("/outreach");
  return { success: true };
}

export async function queueMessageAction(messageId: string) {
  const user = await requireUser();
  await queueMessage(user.id, messageId).catch((err) => console.error(err));
  revalidatePath("/outreach");
}

export async function markSentAction(messageId: string) {
  const user = await requireUser();
  await markManuallySent(user.id, messageId).catch((err) => console.error(err));
  revalidatePath("/outreach");
}

/** Actually sends a QUEUED message via the user's connected Gmail account. */
export async function sendMessageAction(messageId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  try {
    await sendMessage(user.id, messageId);
    revalidatePath("/outreach");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to send." };
  }
}

/** Checks sent messages' Gmail threads for replies and updates status accordingly. */
export async function checkOutreachRepliesAction(): Promise<{ checked: number; replied: number } | { error: string }> {
  const user = await requireUser();
  try {
    const result = await scanOutreachRepliesForUser(user.id);
    revalidatePath("/outreach");
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to check replies." };
  }
}

export async function suggestContactsAction(companyId: string): Promise<Array<{ email: string; confidence: "LOW" }>> {
  await requireUser();
  if (!companyId) return [];
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company?.domain) return [];
  return suggestPatternContacts(company.domain);
}

export async function addSuggestedContactAction(companyId: string, email: string): Promise<void> {
  await requireUser();
  await saveSuggestedContact(companyId, email);
  revalidatePath("/outreach");
}
