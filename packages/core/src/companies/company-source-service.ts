import { prisma } from "@hunter/db";
import { canonicalizeCompanyName, extractDomain } from "../dedup/company";
import type { AtsType } from "../domain/job";

export interface AddCompanySourceParams {
  companyName: string;
  companyDomain?: string;
  atsType: AtsType;
  externalToken: string;
  boardUrl?: string;
}

/**
 * Registers a company + its job-board source (Greenhouse/Lever/Ashby/
 * SmartRecruiters token, or a generic career-page URL as `externalToken`).
 * Does NOT call the adapter itself — packages/core stays adapter-agnostic
 * (see job-ingestion-service.ts); the caller (apps/web) fetches jobs via
 * `@hunter/adapters` and passes each into `ingestJob`.
 */
export async function addCompanySource(params: AddCompanySourceParams) {
  const canonicalName = canonicalizeCompanyName(params.companyName);
  const domain = params.companyDomain ?? extractDomain(params.boardUrl ?? "");

  let company = domain
    ? await prisma.company.findFirst({ where: { domain } })
    : await prisma.company.findFirst({ where: { canonicalName, domain: null } });

  if (!company) {
    company = await prisma.company.create({
      data: { name: params.companyName, canonicalName, domain, careerPageUrl: params.boardUrl },
    });
  }

  const source = await prisma.companySource.upsert({
    where: { atsType_externalToken: { atsType: params.atsType, externalToken: params.externalToken } },
    create: {
      companyId: company.id,
      atsType: params.atsType,
      externalToken: params.externalToken,
      boardUrl: params.boardUrl,
    },
    update: { isActive: true },
  });

  return { companyId: company.id, companySourceId: source.id };
}

export async function listCompanySources() {
  return prisma.companySource.findMany({
    include: { company: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Removes a company source (e.g. a failed/mistaken "add board" attempt).
 * Does NOT delete jobs already ingested from it — a job may have other
 * sources, or still be worth keeping even without its source metadata —
 * this just detaches them (JobSource.companySourceId -> null) before
 * deleting the row, since the FK would otherwise block the delete.
 */
export async function removeCompanySource(companySourceId: string): Promise<void> {
  await prisma.jobSource.updateMany({ where: { companySourceId }, data: { companySourceId: null } });
  await prisma.companySource.delete({ where: { id: companySourceId } });
}

export async function recordFetchResult(
  companySourceId: string,
  status: "ok" | `error:${string}` | "not_connected" | "blocked_by_robots",
): Promise<void> {
  await prisma.companySource.update({
    where: { id: companySourceId },
    data: { lastFetchedAt: new Date(), lastFetchStatus: status },
  });
}
