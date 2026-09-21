const SENIORITY_SYNONYMS: Record<string, string> = {
  sr: "senior",
  "sr.": "senior",
  jr: "junior",
  "jr.": "junior",
  ii: "2",
  iii: "3",
  iv: "4",
};

/**
 * Normalizes a job title for dedup/matching: lowercase, strip req-code and
 * location noise (parenthetical/bracketed tags, trailing "- Req#1234"),
 * normalize seniority tokens via a synonym map, collapse whitespace.
 */
export function normalizeTitle(title: string): string {
  let cleaned = title
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[-–—]\s*req[#:]?\s*\w+/gi, " ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").map((word) => SENIORITY_SYNONYMS[word] ?? word);
  return words.join(" ").trim();
}

/** Buckets a location string coarsely (city-level or "remote") for dedup key matching. */
export function locationBucket(location?: string, remoteType?: string): string {
  if (remoteType === "REMOTE") return "remote";
  if (!location) return "unknown";
  return location
    .toLowerCase()
    .split(",")[0]!
    .trim();
}
