const STOPWORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "senior",
  "junior",
  "staff",
  "principal",
  "lead",
  "sr",
  "jr",
  "i",
  "ii",
  "iii",
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Deterministic, zero-AI-cost keyword set derived from the profile's own
 * target titles + current title.
 *
 * IMPORTANT — this is a SCORING-PRIORITY helper, not a "this job is
 * relevant" signal. It exists only to decide which unscored jobs are worth
 * spending a real AI match call on first (scoring is quota-limited, so it
 * can't run on everything). It must never be used to label a job "relevant"
 * on its own — the only defensible relevance claim is an actual computed
 * match score clearing the user's threshold. Mixing "title looks plausible"
 * in with "AI confirmed this is a good match" in the same visual tier was
 * exactly what made the Jobs/Applications/Fresh-Matches pages feel noisy
 * and untrustworthy — every page now shows AI-scored, passing jobs as the
 * only "relevant" tier, with unscored jobs in a clearly separate section.
 */
export function deriveRelevanceKeywords(titles: string[]): string[] {
  const words = titles
    .flatMap((t) => t.toLowerCase().split(/[^a-z0-9]+/))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return Array.from(new Set(words));
}

/**
 * Whole-word match only (not substring) — a naive `.includes()` check
 * against a short keyword like "app" or "web" matches almost anything
 * ("Apparel", "Webinar", "Happy Hour"), which is exactly the false-positive
 * pattern that made an earlier version of this function useless.
 */
export function isTitleLikelyRelevant(jobTitle: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true; // no profile info to filter on — don't hide anything
  return keywords.some((kw) => new RegExp(`\\b${escapeRegex(kw)}\\b`, "i").test(jobTitle));
}
