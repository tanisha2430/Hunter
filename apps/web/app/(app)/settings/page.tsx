import { prisma } from "@hunter/db";
import { PageHeader } from "@hunter/ui";
import { getCurrentUser } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";
import { GmailConnectionCard } from "./gmail-connection-card";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail_connected?: string; gmail_error?: string }>;
}) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  const settings = user ? await prisma.settings.findUnique({ where: { userId: user.id } }) : null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Settings" description="Search strategy, hard rejection rules, and outreach limits." />
      {user ? (
        <GmailConnectionCard userId={user.id} connected={params.gmail_connected} error={params.gmail_error} />
      ) : null}
      <SettingsForm settings={settings} />
    </div>
  );
}
