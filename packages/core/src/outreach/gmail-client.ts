import { prisma } from "@hunter/db";
import { encryptJson, decryptJson, type EncryptedBlob } from "../security/crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
].join(" ");

export function buildGmailAuthUrl(params: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES);
  url.searchParams.set("access_type", "offline"); // required to get a refresh_token
  url.searchParams.set("prompt", "consent"); // force refresh_token even on re-auth
  url.searchParams.set("state", params.state);
  return url.toString();
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export async function exchangeCodeForTokens(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ tokens: StoredTokens; email: string }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail OAuth code exchange failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as GoogleTokenResponse;
  if (!json.refresh_token) {
    throw new Error(
      "Google did not return a refresh token — revoke this app's access at https://myaccount.google.com/permissions and try connecting again (Google only issues a refresh token on first consent).",
    );
  }

  const tokens: StoredTokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };

  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${json.access_token}` },
  });
  const userInfo = (await userInfoRes.json()) as { email?: string };

  return { tokens, email: userInfo.email ?? "" };
}

async function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<StoredTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail token refresh failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as GoogleTokenResponse;
  return {
    accessToken: json.access_token,
    refreshToken, // Google doesn't rotate the refresh token on a normal refresh
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

/** Returns a valid (non-expired) access token for this user's connected Gmail account, refreshing and re-persisting if needed. */
export async function getValidAccessToken(
  userId: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; connectedAccountId: string } | null> {
  const account = await prisma.connectedAccount.findFirst({ where: { userId, provider: "GMAIL" } });
  if (!account) return null;

  let tokens = decryptJson<StoredTokens>(account.encryptedTokens as unknown as EncryptedBlob);

  if (Date.now() > tokens.expiresAt - 60_000) {
    tokens = await refreshAccessToken(tokens.refreshToken, clientId, clientSecret);
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: { encryptedTokens: encryptJson(tokens) as never, lastUsedAt: new Date() },
    });
  } else {
    await prisma.connectedAccount.update({ where: { id: account.id }, data: { lastUsedAt: new Date() } });
  }

  return { accessToken: tokens.accessToken, connectedAccountId: account.id };
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sendGmailMessage(
  accessToken: string,
  params: { to: string; subject: string; body: string; fromName?: string },
): Promise<{ id: string; threadId: string }> {
  const headers = [
    `To: ${params.to}`,
    params.fromName ? `From: ${params.fromName}` : undefined,
    `Subject: ${params.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
  ]
    .filter(Boolean)
    .join("\r\n");
  const raw = base64UrlEncode(`${headers}\r\n\r\n${params.body}`);

  const res = await fetch(`${GMAIL_API}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    throw new Error(`Gmail send failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as { id: string; threadId: string };
}

/**
 * Number of messages in a Gmail thread — used to detect replies to a sent
 * outreach email: a fresh single-recipient thread starts at 1 message, so
 * anything more means the recipient (or someone) replied into it.
 */
export async function getGmailThreadMessageCount(accessToken: string, threadId: string): Promise<number> {
  const res = await fetch(`${GMAIL_API}/threads/${threadId}?format=minimal`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Gmail thread lookup failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { messages?: unknown[] };
  return json.messages?.length ?? 0;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  bodyText: string;
  date: string;
}

/** Lists recent inbox messages matching a Gmail search query (e.g. `newer_than:7d`). */
export async function listRecentMessages(
  accessToken: string,
  query: string,
  maxResults = 25,
): Promise<GmailMessageSummary[]> {
  const listRes = await fetch(
    `${GMAIL_API}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) {
    throw new Error(`Gmail list failed (${listRes.status}): ${await listRes.text()}`);
  }
  const listJson = (await listRes.json()) as { messages?: Array<{ id: string; threadId: string }> };
  const ids = listJson.messages ?? [];

  const summaries: GmailMessageSummary[] = [];
  for (const { id, threadId } of ids) {
    const msgRes = await fetch(`${GMAIL_API}/messages/${id}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!msgRes.ok) continue;
    const msg = (await msgRes.json()) as {
      snippet?: string;
      payload?: { headers?: Array<{ name: string; value: string }>; body?: { data?: string }; parts?: Array<{ mimeType: string; body?: { data?: string } }> };
    };
    const headers = msg.payload?.headers ?? [];
    const from = headers.find((h) => h.name === "From")?.value ?? "";
    const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
    const date = headers.find((h) => h.name === "Date")?.value ?? "";

    const plainPart =
      msg.payload?.body?.data ??
      msg.payload?.parts?.find((p) => p.mimeType === "text/plain")?.body?.data ??
      msg.payload?.parts?.find((p) => p.mimeType === "text/html")?.body?.data;
    const bodyText = plainPart
      ? Buffer.from(plainPart.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
      : (msg.snippet ?? "");

    summaries.push({ id, threadId, from, subject, snippet: msg.snippet ?? "", bodyText, date });
  }
  return summaries;
}
