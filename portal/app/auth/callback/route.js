import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * OAUTH CALLBACK
 * ==============
 * Where Google (or any other provider) sends the user back to.
 *
 * The browser client uses the PKCE flow, which does not hand back a session
 * directly — it returns a one-time `code`, and the code verifier that proves
 * the exchange is legitimate lives in an http-only cookie the browser cannot
 * read. So the exchange has to happen on the server, which is what this route
 * is for. Trying to do it client-side fails with "invalid request: both auth
 * code and code verifier should be non-empty", which is not an obvious message
 * to work backwards from.
 */
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/";

  /* The provider reports its own failures here rather than at the redirect, so
     they have to be read off the query string and carried back to the login
     page — otherwise a declined consent screen lands on a blank page. */
  const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(providerError)}`, url.origin)
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const store = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            /* Called from a context where cookies are read-only. Harmless here:
               the redirect below carries the Set-Cookie headers anyway. */
          }
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin)
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
