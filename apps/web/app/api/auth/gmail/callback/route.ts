import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens, encryptJson } from "@hunter/core";
import { prisma } from "@hunter/db";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("gmail_oauth_state")?.value;
  cookieStore.delete("gmail_oauth_state");

  if (errorParam) {
    return NextResponse.redirect(`${origin}/settings?gmail_error=${encodeURIComponent(errorParam)}`);
  }
  if (!code || !state || state !== expectedState) {
    return NextResponse.redirect(`${origin}/settings?gmail_error=invalid_state`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect(`${origin}/settings?gmail_error=not_configured`);
  }

  try {
    const { tokens, email } = await exchangeCodeForTokens({ code, clientId, clientSecret, redirectUri });

    await prisma.connectedAccount.upsert({
      where: { userId_provider: { userId: user.id, provider: "GMAIL" } },
      create: {
        userId: user.id,
        provider: "GMAIL",
        encryptedTokens: encryptJson(tokens) as never,
        scopes: ["gmail.send", "gmail.readonly"],
        emailAddress: email,
      },
      update: {
        encryptedTokens: encryptJson(tokens) as never,
        emailAddress: email,
        connectedAt: new Date(),
      },
    });

    return NextResponse.redirect(`${origin}/settings?gmail_connected=1`);
  } catch (err) {
    return NextResponse.redirect(
      `${origin}/settings?gmail_error=${encodeURIComponent(err instanceof Error ? err.message : "unknown")}`,
    );
  }
}
