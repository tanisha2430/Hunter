import { prisma } from "@hunter/db";
import type { ContactConfidence } from "@hunter/db";

const COMMON_PATTERNS = ["careers", "talent", "recruiting", "jobs", "hr"];

export interface AddManualContactParams {
  companyId: string;
  fullName?: string;
  title?: string;
  email?: string;
  linkedinUrl?: string;
  role?: string;
  notes?: string;
  verified: boolean;
}

/**
 * Contacts are never fabricated. Three trust tiers:
 * 1. Manual entry (this function, `source: "manual"`) — the user found this
 *    themselves; HIGH confidence only if they explicitly mark it verified.
 * 2. Pattern-guess suggestions (`suggestPatternContacts`) — always LOW
 *    confidence, never auto-used to send without explicit confirmation.
 * 3. Optional third-party enrichment API (`EMAIL_DISCOVERY_PROVIDER` env
 *    var, off by default) — a legitimate paid data service, not scraping;
 *    not implemented as a hard dependency since it's optional by design.
 */
export async function addManualContact(params: AddManualContactParams) {
  const confidence: ContactConfidence = params.verified ? "HIGH" : "MEDIUM";
  return prisma.companyContact.create({
    data: {
      companyId: params.companyId,
      fullName: params.fullName,
      title: params.title,
      email: params.email,
      linkedinUrl: params.linkedinUrl,
      role: params.role,
      source: "manual",
      confidence,
      verifiedAt: params.verified ? new Date() : null,
      notes: params.notes,
    },
  });
}

export function suggestPatternContacts(domain: string): Array<{ email: string; confidence: "LOW" }> {
  return COMMON_PATTERNS.map((prefix) => ({ email: `${prefix}@${domain}`, confidence: "LOW" as const }));
}

/** Saves one of `suggestPatternContacts`'s guesses as a real contact, always LOW confidence and unverified — a guess never gets to claim it was manually confirmed. */
export async function saveSuggestedContact(companyId: string, email: string) {
  return prisma.companyContact.create({
    data: { companyId, email, source: "pattern_guess", confidence: "LOW" },
  });
}

export async function listContactsForCompany(companyId: string) {
  return prisma.companyContact.findMany({ where: { companyId }, orderBy: { confidence: "desc" } });
}

/**
 * Optional paid enrichment provider (e.g. Hunter.io-style domain search),
 * gated behind EMAIL_DISCOVERY_PROVIDER + the user's own API key. Off by
 * default — the platform works fully without it via manual entry.
 */
export async function enrichContactsFromProvider(domain: string): Promise<
  Array<{ email: string; fullName?: string; title?: string; confidence: "MEDIUM" }>
> {
  if (process.env.EMAIL_DISCOVERY_PROVIDER !== "hunter" || !process.env.HUNTER_API_KEY) {
    return [];
  }
  const res = await fetch(
    `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${process.env.HUNTER_API_KEY}`,
  );
  if (!res.ok) return [];
  const json = (await res.json()) as {
    data?: { emails?: Array<{ value: string; first_name?: string; last_name?: string; position?: string }> };
  };
  return (json.data?.emails ?? []).map((e) => ({
    email: e.value,
    fullName: [e.first_name, e.last_name].filter(Boolean).join(" ") || undefined,
    title: e.position,
    confidence: "MEDIUM" as const,
  }));
}
