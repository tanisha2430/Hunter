import { getProfile } from "@hunter/core";
import { PageHeader } from "@hunter/ui";
import { getCurrentUser } from "@/lib/supabase/server";
import { ProfileForm } from "./profile-form";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  const profile = user ? await getProfile(user.id) : null;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Profile" description="This powers matching, hard-rejection rules, and application answers." />
      <ProfileForm profile={profile} />
    </div>
  );
}
