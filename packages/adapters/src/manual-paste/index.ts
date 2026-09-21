import type { NormalizedJob } from "@hunter/core";
import type { AdapterCapabilities } from "../types";

export const MANUAL_PASTE_CAPABILITIES: AdapterCapabilities = {
  search: false,
  details: true,
  apply: false,
  automatedApply: false,
};

export interface ManualPasteInput {
  url?: string;
  rawText?: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Manual paste is the one adapter where AI extraction is the PRIMARY path,
 * not a fallback — there's no structured source data at all. This function
 * only does the deterministic half (fetch-and-strip, or pass through raw
 * text); the actual field extraction is `packages/core`'s job-extraction
 * task, run unconditionally on the returned shell for this atsType.
 */
export async function fetchManualPasteShell(input: ManualPasteInput): Promise<NormalizedJob> {
  let text: string;
  let sourceUrl: string;

  if (input.rawText) {
    text = input.rawText.trim();
    sourceUrl = "";
  } else if (input.url) {
    const res = await fetch(input.url, {
      headers: { "User-Agent": "AIJobHunter/1.0 (+personal job search assistant)" },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch pasted job URL (${res.status}): ${input.url}`);
    }
    text = stripHtml(await res.text());
    sourceUrl = input.url;
  } else {
    throw new Error("ManualPaste requires either `url` or `rawText`.");
  }

  return {
    sourceId: sourceUrl || `manual-${Date.now()}`,
    sourceUrl,
    atsType: "MANUAL_PASTE",
    title: "",
    company: { name: "" },
    description: text,
    skills: [],
    remoteType: "UNKNOWN",
    employmentType: "UNKNOWN",
    applicationUrl: sourceUrl,
    rawData: { rawText: text },
  };
}
