import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { AppShellClient } from "@/components/app-shell-client";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // Belt-and-suspenders: proxy.ts already redirects unauthenticated visitors,
  // but Server Actions/direct navigation can bypass a matcher, so re-check here.
  if (!user) {
    redirect("/login");
  }

  return <AppShellClient userLabel={user.email ?? undefined}>{children}</AppShellClient>;
}
