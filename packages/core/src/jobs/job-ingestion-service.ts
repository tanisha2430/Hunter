import { prisma, Prisma } from "@hunter/db";
import type { NormalizedJob } from "../domain/job";
import { canonicalizeCompanyName, extractDomain } from "../dedup/company";
import { normalizeTitle, locationBucket } from "../dedup/title";
import {
  DEFAULT_DEDUP_THRESHOLDS,
  jaccardVerdict,
  embeddingVerdict,
  shouldPromoteToPrimary,
  type DedupThresholds,
} from "../dedup/engine";
import { embed } from "../ai/ai-client";
import { backfillJobFields } from "./job-extraction-agent";

export interface IngestJobResult {
  jobId: string;
  isNewJob: boolean;
  isNewCompany: boolean;
}

async function resolveCompany(job: NormalizedJob, thresholds: DedupThresholds): Promise<{ id: string; isNew: boolean }> {
  const canonicalName = canonicalizeCompanyName(job.company.name);
  const domain = job.company.domain ?? extractDomain(job.sourceUrl) ?? extractDomain(job.applicationUrl);

  if (domain) {
    const byDomain = await prisma.company.findFirst({ where: { domain } });
    if (byDomain) return { id: byDomain.id, isNew: false };
  }

  const byName = await prisma.company.findFirst({ where: { canonicalName, domain: domain ?? null } });
  if (byName) return { id: byName.id, isNew: false };

  // Fuzzy fallback only when there's no domain to key off of exactly —
  // domain match above is treated as near-certain identity per the
  // architecture doc; trigram similarity is a lower-confidence signal used
  // to avoid an obvious near-duplicate ("Meta" vs "Meta Platforms"), not to
  // silently merge unrelated companies, so it stays a high threshold.
  if (!domain) {
    const fuzzyMatches = await prisma.$queryRaw<Array<{ id: string; sim: number }>>`
      select id, similarity("canonicalName", ${canonicalName}) as sim
      from companies
      where similarity("canonicalName", ${canonicalName}) > ${thresholds.companyNameTrigram}
      order by sim desc
      limit 1
    `;
    if (fuzzyMatches[0]) return { id: fuzzyMatches[0].id, isNew: false };
  }

  const created = await prisma.company.create({
    data: { name: job.company.name, canonicalName, domain, logoUrl: job.company.logoUrl },
  });
  return { id: created.id, isNew: true };
}

async function storeEmbedding(jobId: string, vector: number[]): Promise<void> {
  const vectorLiteral = `[${vector.join(",")}]`;
  await prisma.$executeRaw`
    update jobs set "descriptionEmbedding" = ${vectorLiteral}::vector where id = ${jobId}
  `;
}

async function getEmbedding(jobId: string): Promise<number[] | null> {
  const rows = await prisma.$queryRaw<Array<{ vec: string | null }>>`
    select "descriptionEmbedding"::text as vec from jobs where id = ${jobId}
  `;
  const raw = rows[0]?.vec;
  if (!raw) return null;
  return raw.slice(1, -1).split(",").map(Number);
}

/**
 * Full ingestion pipeline for one NormalizedJob: AI backfill of missing
 * structured fields -> company resolution -> job-level dedup (identity keys
 * first, then Jaccard, then embeddings only for the ambiguous band) ->
 * persistence. This is the only place a NormalizedJob becomes a `Job` row.
 *
 * `useAI` (default true) gates EVERY AI call in this function (backfill +
 * both embedding calls). It defaults to false for bulk board ingestion (see
 * `ingestJobs`) — a real board fetch (Stripe: 633 postings) would otherwise
 * fire one AI backfill call per job missing salary/experience (nearly all of
 * them on Greenhouse, which doesn't expose those fields), instantly
 * exhausting a 20-requests/day free-tier quota on a single "add company"
 * click. With `useAI: false`, ingestion is pure data-fetch-and-store; an
 * ambiguous dedup verdict falls back to "distinct" rather than escalating to
 * an embedding call. Per-job enrichment (backfill) should happen lazily,
 * scoped to a job the user actually looks at — not during bulk ingest.
 */
export async function ingestJob(
  rawJob: NormalizedJob,
  options: { userId?: string; thresholds?: DedupThresholds; useAI?: boolean } = {},
): Promise<IngestJobResult> {
  const thresholds = options.thresholds ?? DEFAULT_DEDUP_THRESHOLDS;
  const useAI = options.useAI ?? true;
  const job = useAI ? await backfillJobFields(rawJob, options.userId) : rawJob;

  // Step 1: exact identity match on (atsType, externalId) — same posting re-fetched.
  const existingSource = await prisma.jobSource.findUnique({
    where: { atsType_externalId: { atsType: job.atsType, externalId: job.sourceId } },
  });
  if (existingSource) {
    await prisma.jobSource.update({
      where: { id: existingSource.id },
      data: { rawData: job.rawData as Prisma.InputJsonValue, fetchedAt: new Date() },
    });
    await prisma.job.update({ where: { id: existingSource.jobId }, data: { lastSeenAt: new Date() } });
    return { jobId: existingSource.jobId, isNewJob: false, isNewCompany: false };
  }

  // Step 2: normalized applicationUrl match — same posting via a different adapter.
  if (job.applicationUrl) {
    const normalizedUrl = job.applicationUrl.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
    const byUrl = await prisma.jobSource.findFirst({
      where: { sourceUrl: { contains: normalizedUrl, mode: "insensitive" } },
    });
    if (byUrl) {
      await prisma.job.update({ where: { id: byUrl.jobId }, data: { lastSeenAt: new Date() } });
      try {
        await prisma.jobSource.create({
          data: {
            jobId: byUrl.jobId,
            atsType: job.atsType,
            externalId: job.sourceId,
            sourceUrl: job.sourceUrl,
            rawData: job.rawData as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        // A concurrent ingestion run (e.g. two overlapping refreshes) can
        // insert the same (atsType, externalId) between Step 1's check above
        // and this create — that's a benign race, not a real failure: the
        // job is already ingested either way, so swallow the unique-
        // constraint violation (Prisma error code P2002) rather than
        // failing this job's ingestion over a duplicate that already exists.
        const isUniqueConstraintRace =
          typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002";
        if (!isUniqueConstraintRace) throw err;
      }
      return { jobId: byUrl.jobId, isNewJob: false, isNewCompany: false };
    }
  }

  const { id: companyId, isNew: isNewCompany } = await resolveCompany(job, thresholds);
  const normalizedTitle = normalizeTitle(job.title);
  const bucket = locationBucket(job.location, job.remoteType);
  const windowStart = new Date(Date.now() - thresholds.candidateWindowDays * 24 * 60 * 60 * 1000);

  // Step 3: fuzzy candidate match — same company + normalized title + location bucket, recently posted.
  const rawCandidates = await prisma.job.findMany({
    where: { companyId, normalizedTitle, isActive: true, firstSeenAt: { gte: windowStart } },
    select: {
      id: true,
      description: true,
      salaryMin: true,
      experienceMin: true,
      requirements: true,
      location: true,
      remoteType: true,
    },
  });
  const candidates = rawCandidates.filter((c) => locationBucket(c.location ?? undefined, c.remoteType) === bucket);

  for (const candidate of candidates) {
    const verdict = jaccardVerdict(candidate.description, job.description, thresholds);
    let isDuplicate = verdict === "duplicate";

    if (verdict === "ambiguous" && useAI) {
      const [incomingVec] = await embed({ texts: [job.description], taskType: "EMBEDDING", userId: options.userId });
      let candidateVec: number[] | undefined = (await getEmbedding(candidate.id)) ?? undefined;
      if (!candidateVec) {
        [candidateVec] = await embed({ texts: [candidate.description], taskType: "EMBEDDING", userId: options.userId });
        await storeEmbedding(candidate.id, candidateVec!);
      }
      isDuplicate = embeddingVerdict(candidateVec!, incomingVec!, thresholds) === "duplicate";
    }

    if (isDuplicate) {
      await prisma.job.update({ where: { id: candidate.id }, data: { lastSeenAt: new Date() } });
      const newJobSource = await prisma.jobSource.create({
        data: {
          jobId: candidate.id,
          atsType: job.atsType,
          externalId: job.sourceId,
          sourceUrl: job.sourceUrl,
          rawData: job.rawData as Prisma.InputJsonValue,
        },
      });

      const shouldPromote = shouldPromoteToPrimary(
        {
          hasSalary: candidate.salaryMin !== null,
          hasExperience: candidate.experienceMin !== null,
          hasRequirements: !!candidate.requirements,
          descriptionLength: candidate.description.length,
        },
        {
          hasSalary: job.salaryMin !== undefined,
          hasExperience: job.experienceMin !== undefined,
          hasRequirements: !!job.requirements,
          descriptionLength: job.description.length,
        },
      );
      if (shouldPromote) {
        await prisma.job.update({
          where: { id: candidate.id },
          data: {
            title: job.title,
            description: job.description,
            requirements: job.requirements,
            responsibilities: job.responsibilities,
            salaryMin: job.salaryMin,
            salaryMax: job.salaryMax,
            experienceMin: job.experienceMin,
            experienceMax: job.experienceMax,
          },
        });
        await prisma.jobSource.updateMany({ where: { jobId: candidate.id }, data: { isPrimary: false } });
        await prisma.jobSource.update({ where: { id: newJobSource.id }, data: { isPrimary: true } });
      }

      return { jobId: candidate.id, isNewJob: false, isNewCompany };
    }
  }

  // No match at any step — create a new canonical Job + its first JobSource.
  const created = await prisma.job.create({
    data: {
      companyId,
      title: job.title,
      normalizedTitle,
      description: job.description,
      requirements: job.requirements,
      responsibilities: job.responsibilities,
      experienceMin: job.experienceMin,
      experienceMax: job.experienceMax,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      currency: job.currency,
      location: job.location,
      locationCountry: job.locationCountry,
      remoteType: job.remoteType,
      employmentType: job.employmentType,
      seniorityLevel: job.seniorityLevel,
      postedAt: job.postedAt ? new Date(job.postedAt) : undefined,
      applicationUrl: job.applicationUrl,
      jobSources: {
        create: {
          atsType: job.atsType,
          externalId: job.sourceId,
          sourceUrl: job.sourceUrl,
          rawData: job.rawData as Prisma.InputJsonValue,
          isPrimary: true,
        },
      },
    },
  });

  if (useAI) {
    try {
      const [vector] = await embed({ texts: [job.description], taskType: "EMBEDDING", userId: options.userId });
      if (vector) await storeEmbedding(created.id, vector);
    } catch {
      // Embedding is a dedup-quality enhancement, not required for the job to
      // exist — swallow failures here rather than failing ingestion over it.
    }
  }

  return { jobId: created.id, isNewJob: true, isNewCompany };
}
