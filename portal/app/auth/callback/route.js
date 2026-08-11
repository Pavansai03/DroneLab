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

  /* NO CODE IS NOT THE SAME AS NO SESSION.
     GoTrue answers a recovery link with whichever flow it feels like. This
     instance ignores the PKCE challenge the client sends and uses the implicit
     flow instead — it verifies the token itself and puts the session in the URL
     FRAGMENT: #access_token=...&type=recovery.

     A fragment never reaches a server. So this route saw a bare request, sent
     the visitor to /login, and threw the session away with the redirect. From
     the outside that looked like the reset link doing nothing at all.

     Redirecting to `next` instead fixes it without needing to know which flow
     was used, because a browser carries the fragment across a redirect whose
     target has none of its own. The tokens arrive at /reset, where the browser
     client picks them up. `next` defaults to "/", which routes by role or to
     the login page — so a bare visit here still ends up somewhere sensible. */
  if (!code) {
    return NextResponse.redirect(new URL(next, url.origin));
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
