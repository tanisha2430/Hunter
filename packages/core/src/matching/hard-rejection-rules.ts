import { z } from "zod";
import type { NormalizedJob } from "../domain/job";

export const hardRejectionRulesSchema = z.object({
  minSalary: z.object({ amount: z.number(), currency: z.string() }).optional(),
  allowedLocations: z.array(z.string()).default([]),
  remotePreference: z.enum(["remote_only", "hybrid_ok", "onsite_ok", "any"]).default("any"),
  experienceRange: z.object({ minYears: z.number().optional(), maxYears: z.number().optional() }).optional(),
  visaSponsorshipRequired: z.boolean().optional(),
  employmentTypes: z.array(z.string()).default([]),
  requiredTechnologies: z.array(z.string()).default([]),
  requiredTechnologiesMatchMode: z.enum(["any", "all"]).default("any"),
  maxNoticePeriodDays: z.number().optional(),
  enabled: z.boolean().default(true),
  overrides: z.record(z.string(), z.boolean()).default({}),
});
export type HardRejectionRules = z.infer<typeof hardRejectionRulesSchema>;

export const DEFAULT_HARD_REJECTION_RULES: HardRejectionRules = {
  allowedLocations: [],
  remotePreference: "any",
  employmentTypes: [],
  requiredTechnologies: [],
  requiredTechnologiesMatchMode: "any",
  enabled: true,
  overrides: {},
};

// Indian cities with a well-known older/anglicized name still in common use
// on job postings alongside the official current name. Verified this
// matters in practice: a real posting saying "Bangalore, Karnataka" got
// hard-rejected against an allow-list containing "Bengaluru" — same city,
// just a spelling the naive substring check didn't know was equivalent.
const CITY_ALIASES: Record<string, string[]> = {
  bengaluru: ["bangalore"],
  mumbai: ["bombay"],
  kolkata: ["calcutta"],
  chennai: ["madras"],
  gurugram: ["gurgaon"],
  vadodara: ["baroda"],
  puducherry: ["pondicherry"],
};

function locationTextMatches(jobLocation: string, allowedLocation: string): boolean {
  const job = jobLocation.toLowerCase();
  const allowed = allowedLocation.toLowerCase();
  if (job.includes(allowed)) return true;

  const aliases = CITY_ALIASES[allowed] ?? [];
  if (aliases.some((alias) => job.includes(alias))) return true;

  // Also check the reverse direction: the allowed-locations entry itself
  // might be the older name (e.g. user typed "Gurgaon") while the job
  // posting uses the current official name ("Gurugram").
  for (const [official, olderNames] of Object.entries(CITY_ALIASES)) {
    if (olderNames.includes(allowed) && job.includes(official)) return true;
  }
  return false;
}

export interface RejectionCheckInput {
  job: NormalizedJob;
  candidateYearsExperience?: number;
  candidateNeedsVisaSponsorship?: boolean;
}

export interface RejectionResult {
  rejected: boolean;
  reasons: string[];
}

/**
 * Deterministic pre-filter — runs BEFORE any AI scoring and can exclude a
 * job outright regardless of how good an AI opinion might be. Each rule is
 * independently overridable via `rules.overrides[ruleKey] = true`, which
 * makes that rule's failures non-fatal without disabling the whole engine.
 */
export function evaluateHardRejectionRules(rules: HardRejectionRules, input: RejectionCheckInput): RejectionResult {
  if (!rules.enabled) return { rejected: false, reasons: [] };

  const reasons: string[] = [];
  const { job } = input;
  const isOverridden = (key: keyof HardRejectionRules) => rules.overrides[key] === true;

  if (rules.minSalary && !isOverridden("minSalary")) {
    // Only reject when the job states a salary ceiling we know is below the
    // floor — an unknown salary is not treated as a failure (nothing to
    // reject on), consistent with "never reject on missing data alone".
    if (job.salaryMax !== undefined && job.salaryMax < rules.minSalary.amount) {
      reasons.push(
        `Salary ceiling (${job.salaryMax} ${job.currency ?? rules.minSalary.currency}) is below your minimum of ${rules.minSalary.amount} ${rules.minSalary.currency}.`,
      );
    }
  }

  if (rules.allowedLocations.length > 0 && !isOverridden("allowedLocations") && job.remoteType !== "REMOTE") {
    // Consistent with the salary rule above: an unknown location is neutral,
    // not a failure. Previously this rejected outright whenever the source
    // didn't provide a location (common for bulk-ingested/scraped postings
    // since backfill AI calls were removed from ingestion) — which silently
    // hard-rejected jobs based on our own data gap, not a real mismatch.
    if (job.location) {
      const matches = rules.allowedLocations.some((loc) => locationTextMatches(job.location!, loc));
      if (!matches) {
        reasons.push(`Location "${job.location}" is not in your allowed locations.`);
      }
    }
  }

  if (rules.remotePreference !== "any" && !isOverridden("remotePreference")) {
    if (rules.remotePreference === "remote_only" && job.remoteType !== "REMOTE") {
      reasons.push("You require fully remote roles; this job is not remote.");
    }
    if (rules.remotePreference === "hybrid_ok" && job.remoteType === "ONSITE") {
      reasons.push("You require hybrid or remote; this job is fully onsite.");
    }
  }

  if (rules.experienceRange && !isOverridden("experienceRange")) {
    const years = input.candidateYearsExperience;
    if (years !== undefined) {
      if (job.experienceMin !== undefined && years < job.experienceMin - 0.5) {
        reasons.push(`Job requires at least ${job.experienceMin} years; you have ${years}.`);
      }
      if (rules.experienceRange.maxYears !== undefined && job.experienceMin !== undefined) {
        if (job.experienceMin > rules.experienceRange.maxYears) {
          reasons.push(`Job's required experience (${job.experienceMin}y) exceeds your stated max (${rules.experienceRange.maxYears}y).`);
        }
      }
    }
  }

  if (rules.visaSponsorshipRequired && !isOverridden("visaSponsorshipRequired")) {
    if (input.candidateNeedsVisaSponsorship) {
      const mentionsNoSponsorship = /no (visa )?sponsorship|not (able|eligible) to sponsor/i.test(job.description);
      if (mentionsNoSponsorship) {
        reasons.push("Job explicitly states no visa sponsorship, but you require it.");
      }
    }
  }

  if (rules.employmentTypes.length > 0 && !isOverridden("employmentTypes")) {
    if (job.employmentType !== "UNKNOWN" && !rules.employmentTypes.includes(job.employmentType)) {
      reasons.push(`Employment type "${job.employmentType}" is not in your accepted list.`);
    }
  }

  // Same reasoning as location above: a job with barely any description text
  // (common for generic-career-page fallback scrapes that couldn't find
  // structured data) can never genuinely satisfy this check either way —
  // that's a data gap, not evidence the job lacks your required tech.
  if (rules.requiredTechnologies.length > 0 && !isOverridden("requiredTechnologies") && job.description.trim().length >= 100) {
    const descLower = job.description.toLowerCase();
    const skillsLower = job.skills.map((s) => s.toLowerCase());
    const present = rules.requiredTechnologies.filter(
      (tech) => descLower.includes(tech.toLowerCase()) || skillsLower.includes(tech.toLowerCase()),
    );
    const satisfied =
      rules.requiredTechnologiesMatchMode === "all"
        ? present.length === rules.requiredTechnologies.length
        : present.length > 0;
    if (!satisfied) {
      const mode = rules.requiredTechnologiesMatchMode === "all" ? "all of" : "any of";
      const missingCount = rules.requiredTechnologies.length - present.length;
      // Never dump the whole list (it can be dozens of entries) — a short
      // example set plus a count is legible, the full list isn't.
      const example = rules.requiredTechnologies.slice(0, 3).join(", ");
      reasons.push(
        `Doesn't mention ${mode} your required technologies (e.g. ${example}${rules.requiredTechnologies.length > 3 ? `, +${rules.requiredTechnologies.length - 3} more` : ""}) — missing ${missingCount}/${rules.requiredTechnologies.length}.`,
      );
    }
  }

  return { rejected: reasons.length > 0, reasons };
}
