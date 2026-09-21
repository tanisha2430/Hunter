import { cache } from "react";
import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client (Server Components/Actions/Route Handlers),
 * bound to the current request's cookies for session-aware queries under RLS.
 * This is NOT the service-role client — use this for anything that should
 * respect the signed-in user's own row-level access.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component with no writable cookie jar —
            // safe to ignore as long as the proxy also refreshes the session.
          }
        },
      },
    },
  );
}

/**
 * `supabase.auth.getUser()` makes a real network round-trip to Supabase's
 * Auth server (by design — it's the one that actually revalidates the
 * token, unlike `getSession()`). The layout and every single page were each
 * calling it separately, tripling that round-trip on every navigation on
 * top of the one `proxy.ts` middleware already does. `cache()` gives this
 * one request-scoped memoization: every caller within the same render still
 * gets the real, verified user, but the network call only happens once.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
