import type { AtsType } from "@hunter/core";
import type { JobSourceAdapter } from "./types";
import { greenhouseAdapter } from "./greenhouse";
import { leverAdapter } from "./lever";
import { ashbyAdapter } from "./ashby";
import { smartRecruitersAdapter } from "./smartrecruiters";
import { indeedAdapter, naukriAdapter, cutshortAdapter } from "./stubs";

/**
 * Lookup for token-addressed job-board adapters (i.e. everything except
 * GENERIC_CAREER_PAGE and MANUAL_PASTE, which take a URL/text rather than a
 * board token — see generic-career-page/ and manual-paste/ directly).
 */
export const JOB_SOURCE_ADAPTER_REGISTRY: Partial<Record<AtsType, JobSourceAdapter>> = {
  GREENHOUSE: greenhouseAdapter,
  LEVER: leverAdapter,
  ASHBY: ashbyAdapter,
  SMARTRECRUITERS: smartRecruitersAdapter,
  INDEED: indeedAdapter,
  NAUKRI: naukriAdapter,
  CUTSHORT: cutshortAdapter,
};

export function getJobSourceAdapter(atsType: AtsType): JobSourceAdapter {
  const adapter = JOB_SOURCE_ADAPTER_REGISTRY[atsType];
  if (!adapter) {
    throw new Error(`No JobSourceAdapter registered for atsType "${atsType}".`);
  }
  return adapter;
}
