import type { ResumeParsedData, TailoredResumePlan, ResumeDiffEntry } from "../domain/resume";

export interface TailorValidationResult {
  content: ResumeParsedData;
  diff: ResumeDiffEntry[];
  violations: string[];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if `rendered`'s distinctive tokens (numbers, capitalized-looking terms) are all traceable to `source`. */
function entityDiffOk(rendered: string, source: string): boolean {
  const normSource = normalize(source);
  const numbers = rendered.match(/\d+(\.\d+)?%?/g) ?? [];
  for (const num of numbers) {
    if (!normSource.includes(num.toLowerCase())) return false;
  }
  return true;
}

/**
 * Deterministic anti-fabrication gate on TAILORING (distinct from the
 * resume-PARSING validator, which checks against raw text — this one checks
 * an AI-generated plan against the already-structured, already-validated
 * source resume). Every violation reverts that unit to the literal source
 * text rather than silently keeping the unvalidated AI version.
 */
export function validateTailoredResumePlan(
  plan: TailoredResumePlan,
  source: ResumeParsedData,
): TailorValidationResult {
  const diff: ResumeDiffEntry[] = [];
  const violations: string[] = [];

  const experienceById = new Map(source.experience.map((e) => [e.id, e]));
  const projectById = new Map(source.projects.map((p) => [p.id, p]));
  const allSourceSkillsAndTech = new Set(
    [...source.technologies, ...source.skills.map((s) => s.name)].map(normalize),
  );

  const validatedExperience = structuredClone(source.experience);

  for (const section of plan.sections) {
    if (section.sectionType !== "experience") continue;
    const sourceRecord = experienceById.get(section.sourceRecordId);
    if (!sourceRecord) {
      violations.push(`sourceRecordId "${section.sourceRecordId}" does not exist in source resume — section dropped.`);
      continue;
    }

    const sourceBulletsById = new Map(sourceRecord.bullets.map((b) => [b.id, b]));
    const targetExp = validatedExperience.find((e) => e.id === sourceRecord.id)!;
    const newBullets = [];

    for (const bullet of section.bullets) {
      const sourceBullet = sourceBulletsById.get(bullet.sourceBulletId);
      if (!sourceBullet) {
        violations.push(`sourceBulletId "${bullet.sourceBulletId}" not found under experience "${sourceRecord.id}" — reverted.`);
        continue;
      }

      const ok = entityDiffOk(bullet.renderedText, sourceBullet.text);
      if (!ok) {
        violations.push(`Bullet "${bullet.sourceBulletId}" introduced a number/fact not in source — reverted to original text.`);
        newBullets.push(sourceBullet);
        diff.push({ targetPath: `experience.${sourceRecord.id}.${sourceBullet.id}`, sourcePath: `experience.${sourceRecord.id}.${sourceBullet.id}`, changeType: "unchanged" });
        continue;
      }

      const emphasized = bullet.emphasizedKeywords.filter((kw) => allSourceSkillsAndTech.has(normalize(kw)));
      const droppedKeywords = bullet.emphasizedKeywords.filter((kw) => !allSourceSkillsAndTech.has(normalize(kw)));
      if (droppedKeywords.length > 0) {
        violations.push(`Bullet "${bullet.sourceBulletId}" emphasized keyword(s) not in candidate's own skills/tech: ${droppedKeywords.join(", ")} — dropped from emphasis.`);
      }

      const changed = normalize(bullet.renderedText) !== normalize(sourceBullet.text);
      newBullets.push({ ...sourceBullet, text: bullet.renderedText, technologies: emphasized.length > 0 ? emphasized : sourceBullet.technologies });
      diff.push({
        targetPath: `experience.${sourceRecord.id}.${sourceBullet.id}`,
        sourcePath: `experience.${sourceRecord.id}.${sourceBullet.id}`,
        changeType: changed ? "reworded" : "unchanged",
      });
    }

    if (newBullets.length > 0) targetExp.bullets = newBullets;
  }

  // Summary: every claim must cite a real source record id.
  const validSummaryIds = plan.summary.sourceRecordIds.filter(
    (id) => experienceById.has(id) || projectById.has(id),
  );
  const invalidSummaryIds = plan.summary.sourceRecordIds.filter((id) => !validSummaryIds.includes(id));
  if (invalidSummaryIds.length > 0) {
    violations.push(`Summary cited unknown source record id(s): ${invalidSummaryIds.join(", ")}.`);
  }
  const summaryOk = validSummaryIds.length > 0 && entityDiffOk(plan.summary.renderedText, JSON.stringify(source));
  const summary = summaryOk ? plan.summary.renderedText : source.summary ?? "";
  if (!summaryOk) {
    violations.push("Tailored summary could not be validated against source — reverted to original summary.");
  }
  diff.push({
    targetPath: "summary",
    changeType: summaryOk ? "generated" : "unchanged",
    rationale: summaryOk ? "AI-generated, grounded in cited source records" : undefined,
  });

  return {
    content: { ...source, experience: validatedExperience, summary },
    diff,
    violations,
  };
}
