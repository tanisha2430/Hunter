import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildGmailAuthUrl } from "@hunter/core";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "http://localhost:3000"));
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "Gmail integration isn't configured (missing GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_REDIRECT_URI)." },
      { status: 500 },
    );
  }

  // CSRF protection: a random state value round-tripped through Google,
  // verified against this short-lived cookie on callback.
  const state = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set("gmail_oauth_state", state, { httpOnly: true, secure: true, maxAge: 600, path: "/" });

  const authUrl = buildGmailAuthUrl({ clientId, redirectUri, state });
  return NextResponse.redirect(authUrl);
}
