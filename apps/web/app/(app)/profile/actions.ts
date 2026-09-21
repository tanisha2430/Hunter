"use server";

import { revalidatePath } from "next/cache";
import { profileInputSchema, upsertProfile } from "@hunter/core";
import { createClient } from "@/lib/supabase/server";

export interface ProfileFormState {
  error?: string;
  success?: boolean;
}

function splitCsv(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function saveProfile(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const raw = {
    fullName: formData.get("fullName") || undefined,
    headline: formData.get("headline") || undefined,
    phone: formData.get("phone") || undefined,
    location: formData.get("location") || undefined,
    linkedinUrl: formData.get("linkedinUrl") || undefined,
    githubUrl: formData.get("githubUrl") || undefined,
    portfolioUrl: formData.get("portfolioUrl") || undefined,
    yearsExperience: formData.get("yearsExperience") || undefined,
    currentTitle: formData.get("currentTitle") || undefined,
    workAuthorization: formData.get("workAuthorization") || undefined,
    noticePeriodDays: formData.get("noticePeriodDays") || undefined,
    targetTitles: splitCsv(formData.get("targetTitles")),
    targetLocations: splitCsv(formData.get("targetLocations")),
    desiredSalaryMin: formData.get("desiredSalaryMin") || undefined,
    desiredSalaryMax: formData.get("desiredSalaryMax") || undefined,
    desiredCurrency: formData.get("desiredCurrency") || "USD",
    careerGoals: formData.get("careerGoals") || undefined,
    companiesToAvoid: splitCsv(formData.get("companiesToAvoid")),
  };

  const parsed = profileInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid profile data." };
  }

  await upsertProfile(user.id, parsed.data);
  revalidatePath("/profile");
  return { success: true };
}
