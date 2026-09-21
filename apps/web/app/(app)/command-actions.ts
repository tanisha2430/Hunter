"use server";

import { parseCommand, dispatchCommand } from "@hunter/core";
import { createClient } from "@/lib/supabase/server";

export interface CommandResult {
  message: string;
}

export async function runCommand(text: string): Promise<CommandResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "Not signed in." };

  const parsed = await parseCommand(text, user.id);
  const result = await dispatchCommand(user.id, parsed);
  return { message: result.message };
}
