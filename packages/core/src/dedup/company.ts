const LEGAL_SUFFIXES = [
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "gmbh",
  "plc",
  "pvt",
  "private",
];

/**
 * Normalizes a company name for identity matching: lowercase, strip legal
 * suffixes and punctuation, collapse whitespace. Used both to key new
 * companies and to compare against existing ones (exact match first, trgm
 * fuzzy match as a fallback — see engine.ts).
 */
export function canonicalizeCompanyName(name: string): string {
  const lower = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = lower.split(" ").filter((word) => !LEGAL_SUFFIXES.includes(word));
  return words.join(" ").trim();
}

/**
 * Multi-tenant ATS hosting domains — NEVER a real company's own domain, so
 * must never be used as a company-identity signal. Verified this the hard
 * way: Lever hosts every customer's postings under the single shared
 * hostname jobs.lever.co (no per-company subdomain), so treating "same
 * domain = same company" silently merged 5 unrelated companies (CRED, Zeta,
 * Meesho, Paytm, MindTickle) into one bogus "cred" company row — the
 * `domain` field just isn't a meaningful company identifier for these hosts.
 */
const SHARED_ATS_HOSTING_DOMAINS = new Set([
  "jobs.lever.co",
  "boards.greenhouse.io",
  "boards-api.greenhouse.io",
  "jobs.ashbyhq.com",
  "api.ashbyhq.com",
  "jobs.smartrecruiters.com",
  "careers.smartrecruiters.com",
  // Adzuna's own redirect/landing domain (per-country TLDs) — every Adzuna
  // posting's sourceUrl/applicationUrl is an adzuna.* redirect link, not the
  // employer's site, so treating it as the company's domain would merge
  // every company found via Adzuna into one (the same class of bug the
  // jobs.lever.co entry above fixed for Lever).
  "adzuna.com",
  "adzuna.in",
  "adzuna.co.uk",
  "adzuna.ca",
  "adzuna.com.au",
]);

/**
 * Extracts a bare domain (no protocol/www/path) from a URL, for identity
 * matching — returns undefined for known shared ATS-hosting domains rather
 * than a misleading "domain" that doesn't actually identify one company.
 */
export function extractDomain(url: string): string | undefined {
  try {
    const { hostname } = new URL(url);
    const bare = hostname.replace(/^www\./, "").toLowerCase();
    return SHARED_ATS_HOSTING_DOMAINS.has(bare) ? undefined : bare;
  } catch {
    return undefined;
  }
}
