import type { AdapterCapabilities, JobSourceAdapter } from "../types";
import { AdapterNotConnectedError } from "../types";

const NOT_CONNECTED_CAPABILITIES: AdapterCapabilities = {
  search: false,
  details: false,
  apply: false,
  automatedApply: false,
};

function makeStub(
  atsType: "INDEED" | "NAUKRI" | "CUTSHORT",
  reason: string,
): JobSourceAdapter {
  return {
    atsType,
    capabilities: NOT_CONNECTED_CAPABILITIES,
    async searchJobs(): Promise<never> {
      throw new AdapterNotConnectedError(atsType, reason);
    },
    async getJobDetails(): Promise<never> {
      throw new AdapterNotConnectedError(atsType, reason);
    },
  };
}

// None of these three offer a public, individual-developer-facing job
// search/apply API as of 2026 — each requires an approved employer/partner
// business relationship, which is out of scope for a personal project. The
// UI surfaces these as "Not Connected", never as a silent empty result set.

export const indeedAdapter = makeStub(
  "INDEED",
  "Indeed has no public job search API for individual developers. Their XML feed / Apply API " +
    "requires an approved employer or publisher partnership. To enable: apply for Indeed " +
    "Publisher/Partner access and implement against their partner API contract.",
);

export const naukriAdapter = makeStub(
  "NAUKRI",
  "Naukri has no public job search API for individual use — their APIs are B2B recruiter-side " +
    "only. To enable: obtain a business/recruiter API agreement with Naukri.",
);

export const cutshortAdapter = makeStub(
  "CUTSHORT",
  "Cutshort has no documented public job-search API. To enable: contact Cutshort directly " +
    "for a partner/business integration agreement.",
);
