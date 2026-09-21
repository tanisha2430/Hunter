import { ingestJobs } from "@hunter/core";
import { getJobSourceAdapter, genericCareerPageAdapter, AdapterNotConnectedError } from "@hunter/adapters";
import { prisma } from "@hunter/db";

const user = await prisma.user.findUnique({ where: { email: "tanishasaxena1224@gmail.com" } });
const sources = await prisma.companySource.findMany({ where: { isActive: true }, include: { company: true } });

console.log(`Refreshing ${sources.length} sources...`);
let refreshed = 0, totalJobs = 0;

for (const source of sources) {
  const start = Date.now();
  try {
    let jobs;
    if (source.atsType === "GENERIC_CAREER_PAGE") {
      jobs = await genericCareerPageAdapter.discoverJobs(source.boardUrl ?? source.externalToken);
    } else {
      const adapter = getJobSourceAdapter(source.atsType);
      const result = await adapter.searchJobs({ companySourceId: source.id, externalToken: source.externalToken });
      jobs = result.jobs;
    }
    await ingestJobs(jobs, user.id);
    await prisma.companySource.update({ where: { id: source.id }, data: { lastFetchedAt: new Date(), lastFetchStatus: "ok" } });
    refreshed++;
    totalJobs += jobs.length;
    console.log(`[${refreshed}/${sources.length}] ${source.company.name}: ${jobs.length} postings (${Math.round((Date.now()-start)/1000)}s)`);
  } catch (err) {
    const status = err instanceof AdapterNotConnectedError ? "not_connected" : `error:${err.message.slice(0,100)}`;
    await prisma.companySource.update({ where: { id: source.id }, data: { lastFetchedAt: new Date(), lastFetchStatus: status } });
    console.log(`[${refreshed+1}/${sources.length}] ${source.company.name}: FAILED - ${err.message.slice(0,150)}`);
  }
}
console.log(`DONE. Refreshed ${refreshed} sources, ${totalJobs} total postings found.`);
