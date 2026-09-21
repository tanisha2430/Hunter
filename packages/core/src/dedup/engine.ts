import { jaccardSimilarity, cosineSimilarity } from "./similarity";

export type JobDuplicateVerdict = "duplicate" | "ambiguous" | "distinct";

export interface DedupThresholds {
  /** Jaccard token-overlap score at or above which two descriptions are
   * confirmed duplicates without needing an embedding call. */
  jaccardDuplicate: number;
  /** Below this, two descriptions are confirmed distinct without an embedding call. */
  jaccardDistinctFloor: number;
  /** Cosine similarity (embeddings) at or above which an "ambiguous" pair is confirmed duplicate. */
  embeddingDuplicate: number;
  /** Days within which a same-company/title/location posting is considered a duplicate candidate at all. */
  candidateWindowDays: number;
  /** Trigram similarity for fuzzy company-name matching (computed in SQL via pg_trgm, referenced here for documentation). */
  companyNameTrigram: number;
}

export const DEFAULT_DEDUP_THRESHOLDS: DedupThresholds = {
  jaccardDuplicate: 0.6,
  jaccardDistinctFloor: 0.4,
  embeddingDuplicate: 0.92,
  candidateWindowDays: 45,
  companyNameTrigram: 0.85,
};

/**
 * Pure, deterministic first-pass verdict from token-overlap alone. Only
 * called on candidates that already matched on (companyId, normalizedTitle,
 * locationBucket) — see job-ingestion-service.ts for that identity-key step.
 * "ambiguous" means the caller should escalate to an embeddings similarity
 * check (the only place this pipeline spends an AI-provider call).
 */
export function jaccardVerdict(
  candidateDescription: string,
  incomingDescription: string,
  thresholds: DedupThresholds = DEFAULT_DEDUP_THRESHOLDS,
): JobDuplicateVerdict {
  const score = jaccardSimilarity(candidateDescription, incomingDescription);
  if (score >= thresholds.jaccardDuplicate) return "duplicate";
  if (score < thresholds.jaccardDistinctFloor) return "distinct";
  return "ambiguous";
}

/** Second-pass verdict via embedding cosine similarity, for the ambiguous band only. */
export function embeddingVerdict(
  candidateVector: number[],
  incomingVector: number[],
  thresholds: DedupThresholds = DEFAULT_DEDUP_THRESHOLDS,
): JobDuplicateVerdict {
  const score = cosineSimilarity(candidateVector, incomingVector);
  return score >= thresholds.embeddingDuplicate ? "duplicate" : "distinct";
}

export interface SourceCompleteness {
  hasSalary: boolean;
  hasExperience: boolean;
  hasRequirements: boolean;
  descriptionLength: number;
}

/** Simple completeness score used to decide which source "wins" as the canonical record's primary source. */
export function completenessScore(c: SourceCompleteness): number {
  return (
    (c.hasSalary ? 2 : 0) +
    (c.hasExperience ? 2 : 0) +
    (c.hasRequirements ? 1 : 0) +
    Math.min(c.descriptionLength / 500, 2)
  );
}

/** True if the new source is meaningfully more complete than the current primary source. */
export function shouldPromoteToPrimary(current: SourceCompleteness, incoming: SourceCompleteness): boolean {
  return completenessScore(incoming) > completenessScore(current);
}
