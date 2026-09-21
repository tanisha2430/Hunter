"use server";

import { revalidatePath } from "next/cache";
import { hardRejectionRulesSchema } from "@hunter/core";
import { prisma } from "@hunter/db";
import { createClient } from "@/lib/supabase/server";

export interface SettingsFormState {
  error?: string;
  success?: boolean;
}

function splitCsv(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function saveSettings(_prevState: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const searchStrategy = String(formData.get("searchStrategy") ?? "BALANCED");
  const customThresholdRaw = formData.get("customThreshold");
  const customThreshold = customThresholdRaw ? Number(customThresholdRaw) : null;

  const rules = hardRejectionRulesSchema.safeParse({
    minSalary: formData.get("minSalary")
      ? { amount: Number(formData.get("minSalary")), currency: String(formData.get("currency") || "USD") }
      : undefined,
    allowedLocations: splitCsv(formData.get("allowedLocations")),
    remotePreference: String(formData.get("remotePreference") ?? "any"),
    requiredTechnologies: splitCsv(formData.get("requiredTechnologies")),
    requiredTechnologiesMatchMode: String(formData.get("requiredTechnologiesMatchMode") ?? "any"),
    employmentTypes: [],
    enabled: formData.get("rulesEnabled") === "on",
    overrides: {},
  });

  if (!rules.success) {
    return { error: rules.error.issues[0]?.message ?? "Invalid settings." };
  }

  await prisma.settings.update({
    where: { userId: user.id },
    data: {
      searchStrategy: searchStrategy as never,
      customThreshold,
      hardRejectionRules: rules.data,
      dailyOutreachSendCap: Number(formData.get("dailyOutreachSendCap") ?? 10),
    },
  });

  revalidatePath("/settings");
  return { success: true };
}
