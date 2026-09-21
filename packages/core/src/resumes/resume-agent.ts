import { randomUUID } from "node:crypto";
import { generateStructured } from "../ai/ai-client";
import { resumeParsedDataSchema, type ResumeParsedData } from "../domain/resume";

const SYSTEM_PROMPT = `You extract structured resume data from raw resume text for a job-hunting platform.

Rules:
- Every fact you output (employer, title, dates, technology, metric, certification) MUST be
  taken verbatim or near-verbatim from the provided text. Never invent, infer, or embellish
  anything not present in the source.
- Assign a stable unique "id" (a short slug, e.g. "exp-1", "proj-2") to every education,
  experience, project, certification, and achievement record, and to every bullet within an
  experience record — these ids are used later to trace generated content back to this source,
  so keep them stable and unique within the document.
- "technologies", "domains", "metrics", and "keywords" are derived/aggregated fields — populate
  them only from terms that literally appear in the source text.
- If a field genuinely isn't present in the resume, omit it or leave the array empty. Do not
  guess a plausible-sounding value.

You MUST attempt to populate every section this resume actually contains — education, experience,
skills, projects, certifications, achievements, technologies, domains, metrics, and keywords are all
required fields in the output (empty arrays are fine ONLY when the resume truly has nothing for that
section). Do not stop after the contact block.`;

/**
 * Turns raw extracted resume text into ResumeParsedData. This is AI-assisted
 * (unstructured -> structured) but MUST be followed by
 * `validateResumeExtraction` before being trusted/persisted as a "clean"
 * version — this function alone does not guarantee freedom from
 * hallucination, it only proposes.
 */
/**
 * A response that's schema-valid but suspiciously hollow for a resume whose
 * raw text clearly has substantial content — the free-tier flash model
 * occasionally produces this (verified: it's not an error, so the
 * provider-level retry-on-exception never catches it). Treated as a failed
 * attempt worth retrying, since a fresh sample usually succeeds.
 *
 * Specifically checks "experience" and "skills" — NOT "any field at all".
 * A first version of this check accepted the result as soon as ANY section
 * (e.g. just "education") was non-empty, which let a real failure through:
 * education:1 but experience:0, skills:0 on a resume that plainly has both.
 * Those two are the load-bearing fields for matching/tailoring, so both must
 * be present (when the source text is long enough to plausibly contain them).
 */
function looksSuspiciouslyEmpty(data: ResumeParsedData, rawTextLength: number): boolean {
  if (rawTextLength <= 400) return false; // too short to expect much of anything
  return data.experience.length === 0 || data.skills.length === 0;
}

export async function parseResumeToStructured(params: {
  rawText: string;
  userId: string;
}): Promise<{ data: ResumeParsedData; modelUsed: string }> {
  const MAX_ATTEMPTS = 3;
  let lastResult: { data: ResumeParsedData; modelUsed: string } | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data, model } = await generateStructured({
      schema: resumeParsedDataSchema,
      system: SYSTEM_PROMPT,
      prompt: `Extract structured data from this resume text:\n\n${params.rawText}`,
      taskType: "RESUME_PARSING",
      agent: "ResumeAgent",
      userId: params.userId,
      entityRef: { type: "resume_parse", id: randomUUID() },
    });

    lastResult = { data, modelUsed: model };
    if (!looksSuspiciouslyEmpty(data, params.rawText.length)) {
      return lastResult;
    }

    // Brief spacing before the next attempt — this loop's retries stack on
    // top of the provider's own 429/503 retries (see google.ts), and firing
    // immediately again right after a hollow result risks tripping the
    // free tier's per-minute request cap rather than getting a fresh sample.
    if (attempt < MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  // Every attempt came back hollow — surface this clearly rather than
  // silently saving an empty-looking resume the user would only notice later.
  throw new Error(
    "Resume parsing repeatedly came back empty (a known free-tier model instability) — please try uploading again.",
  );
}
