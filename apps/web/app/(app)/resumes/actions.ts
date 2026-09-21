"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createResume, setPrimaryResume, deleteResume } from "@hunter/core";
import { createClient } from "@/lib/supabase/server";

export interface UploadResumeState {
  error?: string;
  warning?: string;
}

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export async function uploadResume(
  _prevState: UploadResumeState,
  formData: FormData,
): Promise<UploadResumeState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const file = formData.get("file") as File | null;
  const label = String(formData.get("label") ?? "").trim();
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const isPrimary = formData.get("isPrimary") === "on";

  if (!file || file.size === 0) return { error: "Choose a resume file." };
  if (!label) return { error: "Give this resume a label (e.g. \"Backend Resume\")." };
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { error: "Only PDF or DOCX files are supported." };
  }

  const resumeId = randomUUID();
  const storagePath = `${user.id}/${resumeId}/${file.name}`;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await supabase.storage.from("resumes").upload(storagePath, buffer, {
    contentType: file.type,
  });
  if (uploadError) {
    return { error: `Upload failed: ${uploadError.message}` };
  }

  try {
    const { drops } = await createResume({
      resumeId,
      userId: user.id,
      label,
      tags,
      isPrimary,
      storagePath,
      fileMimeType: file.type,
      fileBuffer: buffer,
    });

    revalidatePath("/resumes");

    if (drops.length > 0) {
      return {
        warning: `Parsed with ${drops.length} item(s) skipped because they weren't found verbatim in your resume text (shown for review, not fabricated).`,
      };
    }
    return {};
  } catch (err) {
    // Roll back the uploaded file if parsing/persistence failed, so we don't
    // leave an orphaned Storage object with no Resume row.
    await supabase.storage.from("resumes").remove([storagePath]);
    return { error: err instanceof Error ? err.message : "Could not process resume." };
  }
}

export async function makePrimaryResume(resumeId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await setPrimaryResume(user.id, resumeId);
  revalidatePath("/resumes");
}

export async function removeResume(resumeId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await deleteResume(user.id, resumeId);
  revalidatePath("/resumes");
}
