import type { ResumeParsedData } from "../domain/resume";

/**
 * Plain-text rendering of a (tailored or base) resume — used so the AI's
 * tailoring work is actually usable by hand: something to copy/paste or
 * download and upload into a company's own application form, since no ATS
 * exposes a public "submit on the candidate's behalf" API to automate that
 * last step itself (see apply-batch-service.ts).
 */
export function renderResumeAsText(data: ResumeParsedData): string {
  const lines: string[] = [];

  lines.push(data.contact.name);
  const contactLine = [data.contact.email, data.contact.phone, data.contact.location, ...data.contact.links]
    .filter(Boolean)
    .join("  |  ");
  if (contactLine) lines.push(contactLine);
  lines.push("");

  if (data.summary) {
    lines.push("SUMMARY");
    lines.push(data.summary);
    lines.push("");
  }

  if (data.experience.length > 0) {
    lines.push("EXPERIENCE");
    for (const exp of data.experience) {
      const dates = [exp.startDate, exp.isCurrent ? "Present" : exp.endDate].filter(Boolean).join(" – ");
      lines.push(`${exp.title}, ${exp.company}${dates ? ` (${dates})` : ""}`);
      for (const bullet of exp.bullets) lines.push(`  - ${bullet.text}`);
      lines.push("");
    }
  }

  if (data.projects.length > 0) {
    lines.push("PROJECTS");
    for (const p of data.projects) {
      lines.push(`${p.name}${p.url ? ` (${p.url})` : ""}`);
      if (p.description) lines.push(`  ${p.description}`);
      if (p.technologies.length > 0) lines.push(`  Technologies: ${p.technologies.join(", ")}`);
      lines.push("");
    }
  }

  if (data.education.length > 0) {
    lines.push("EDUCATION");
    for (const e of data.education) {
      const dates = [e.startDate, e.endDate].filter(Boolean).join(" – ");
      lines.push(
        `${e.degree}${e.field ? ` in ${e.field}` : ""}, ${e.institution}${dates ? ` (${dates})` : ""}${e.gpa ? ` — GPA ${e.gpa}` : ""}`,
      );
    }
    lines.push("");
  }

  if (data.skills.length > 0) {
    lines.push("SKILLS");
    lines.push(data.skills.map((s) => s.name).join(", "));
    lines.push("");
  }

  if (data.certifications.length > 0) {
    lines.push("CERTIFICATIONS");
    for (const c of data.certifications) {
      lines.push(`${c.name}${c.issuer ? ` — ${c.issuer}` : ""}${c.date ? ` (${c.date})` : ""}`);
    }
    lines.push("");
  }

  if (data.achievements.length > 0) {
    lines.push("ACHIEVEMENTS");
    for (const a of data.achievements) lines.push(`- ${a.text}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}
