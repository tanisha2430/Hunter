import type { NormalizedJob } from "../../domain/job";
import type { DimensionResult } from "./deterministic-scores";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Exact/alias overlap between the job's listed+description-mentioned
 * technologies and the candidate's own technology list. Purely deterministic
 * — embedding-based synonym tie-breaking (e.g. "Node.js" vs "Node") is left
 * as a documented enhancement rather than spending an AI call on every job.
 */
export function scoreTechnology(
  job: NormalizedJob,
  candidateTechnologies: string[],
): DimensionResult<{ matchedTech: string[]; missingTech: string[] }> {
  const jobTechRaw = job.skills.length > 0 ? job.skills : extractLikelyTechMentions(job.description);
  if (jobTechRaw.length === 0) {
    return { score: 65, extra: { matchedTech: [], missingTech: [] } };
  }

  const candidateSet = new Set(candidateTechnologies.map(normalize));
  const matched: string[] = [];
  const missing: string[] = [];

  for (const tech of jobTechRaw) {
    if (candidateSet.has(normalize(tech))) matched.push(tech);
    else missing.push(tech);
  }

  const score = Math.round((matched.length / jobTechRaw.length) * 100);
  return { score, extra: { matchedTech: matched, missingTech: missing } };
}

const COMMON_TECH_KEYWORDS = [
  "react",
  "node",
  "node.js",
  "typescript",
  "javascript",
  "python",
  "java",
  "go",
  "golang",
  "rust",
  "aws",
  "gcp",
  "azure",
  "postgres",
  "postgresql",
  "mysql",
  "mongodb",
  "redis",
  "kubernetes",
  "docker",
  "graphql",
  "rest",
  "next.js",
  "vue",
  "angular",
  "django",
  "flask",
  "spring",
  "kafka",
  "terraform",
];

/** Best-effort fallback when a source doesn't provide a structured skills list. */
function extractLikelyTechMentions(description: string): string[] {
  const lower = description.toLowerCase();
  return COMMON_TECH_KEYWORDS.filter((tech) => lower.includes(tech));
}
