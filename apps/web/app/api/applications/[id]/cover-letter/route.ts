import { NextResponse } from "next/server";
import { prisma } from "@hunter/db";
import { getCurrentUser } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const application = await prisma.application.findFirst({
    where: { id, userId: user.id },
    include: {
      job: { include: { company: true } },
      coverLetters: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const coverLetter = application?.coverLetters[0];
  if (!application || !coverLetter) {
    return NextResponse.json({ error: "No cover letter found for this application." }, { status: 404 });
  }

  const filename = `cover-letter-${application.job.company.name}-${application.job.title}`
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 100);

  return new NextResponse(coverLetter.content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.txt"`,
    },
  });
}
