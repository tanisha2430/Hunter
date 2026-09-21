import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/proxy";

// Next.js 16 renamed `middleware.ts` -> `proxy.ts` (same NextRequest/NextResponse API).
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // api/internal/* has no browser session to authenticate (cron, not a
    // signed-in user) — it enforces its own shared-secret check instead;
    // see apps/web/app/api/internal/daily-batch/route.ts.
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/internal|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
