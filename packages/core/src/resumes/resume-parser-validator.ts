import type { ResumeParsedData } from "../domain/resume";

export interface ValidationDrop {
  path: string;
  value: string;
  reason: string;
}

export interface ValidatedResumeExtraction {
  data: ResumeParsedData;
  drops: ValidationDrop[];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True if `candidate` is traceable to `sourceText` — either as a direct
 * normalized substring, or (for short multi-word candidates) with enough
 * word-level overlap to allow minor AI reformatting (e.g. date punctuation)
 * without allowing wholesale invention.
 */
function isTraceable(candidate: string, normalizedSource: string): boolean {
  const normCandidate = normalize(candidate);
  if (normCandidate.length === 0) return true; // nothing asserted, nothing to fabricate
  if (normalizedSource.includes(normCandidate)) return true;

  const words = normCandidate.split(" ").filter((w) => w.length > 2);
  if (words.length === 0) return true; // too short/generic to meaningfully check
  const found = words.filter((w) => normalizedSource.includes(w));
  return found.length / words.length >= 0.7;
}

/**
 * Deterministic anti-fabrication gate on resume PARSING (distinct from the
 * tailoring-time validator, which checks AI-generated bullets against a
 * structured source resume rather than raw text). Every company/title/
 * technology/metric/certification the AI extracted must be traceable to the
 * raw source text; anything that isn't is dropped from the structured
 * output and reported in `drops` for manual review rather than silently kept.
 */
export function validateResumeExtraction(
  data: ResumeParsedData,
  rawText: string,
): ValidatedResumeExtraction {
  const normalizedSource = normalize(rawText);
  const drops: ValidationDrop[] = [];

  const experience = data.experience.filter((exp, i) => {
    const companyOk = isTraceable(exp.company, normalizedSource);
    const titleOk = isTraceable(exp.title, normalizedSource);
    if (!companyOk || !titleOk) {
      drops.push({
        path: `experience[${i}]`,
        value: `${exp.title} @ ${exp.company}`,
        reason: !companyOk ? "company not found in source text" : "title not found in source text",
      });
      return false;
    }
    return true;
  });

  const projects = data.projects.filter((proj, i) => {
    const ok = isTraceable(proj.name, normalizedSource);
    if (!ok) {
      drops.push({ path: `projects[${i}]`, value: proj.name, reason: "project name not found in source text" });
    }
    return ok;
  });

  const certifications = data.certifications.filter((cert, i) => {
    const ok = isTraceable(cert.name, normalizedSource);
    if (!ok) {
      drops.push({ path: `certifications[${i}]`, value: cert.name, reason: "certification not found in source text" });
    }
    return ok;
  });

  const technologies = data.technologies.filter((tech, i) => {
    const ok = isTraceable(tech, normalizedSource);
    if (!ok) {
      drops.push({ path: `technologies[${i}]`, value: tech, reason: "technology not found in source text" });
    }
    return ok;
  });

  const metrics = data.metrics.filter((metric, i) => {
    const ok = isTraceable(metric, normalizedSource);
    if (!ok) {
      drops.push({ path: `metrics[${i}]`, value: metric, reason: "metric not found in source text" });
    }
    return ok;
  });

  return {
    data: { ...data, experience, projects, certifications, technologies, metrics },
    drops,
  };
}
