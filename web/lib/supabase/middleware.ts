// Session-refreshing Supabase client for Next.js middleware.
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(items) {
          for (const { name, value } of items) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of items) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refresh access token if expired and forward Set-Cookie to the browser.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const inPortal = path === "/portal" || path.startsWith("/portal/");
  // API routes authenticate themselves and must return JSON (401/403), never an
  // HTML login/role redirect — otherwise client fetches get "<!DOCTYPE…" instead
  // of JSON (e.g. a client POSTing /api/portal/injury).
  const isApi = path.startsWith("/api/");

  // Clients (trainees) get a read-only portal; everyone else is a trainer.
  // One cheap lookup per authenticated request decides which world they're in.
  let isClient = false;
  if (user) {
    const { data: clientRow } = await supabase
      .from("clients")
      .select("id")
      .eq("auth_user_id", user.id)
      .limit(1)
      .maybeSingle();
    isClient = !!clientRow;
  }
  const homeFor = (client: boolean) => (client ? "/portal" : "/");

  // Already-authenticated users have no reason to see the login page.
  if (user && path === "/login") {
    const next = request.nextUrl.searchParams.get("next");
    const dest = next ? safeNext(next) : homeFor(isClient);
    const url = request.nextUrl.clone();
    url.pathname = dest;
    url.search = "";
    return NextResponse.redirect(url);
  }

  const isPublicPath =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/mfa") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname.startsWith("/onboarding") ||
    request.nextUrl.pathname.startsWith("/connect/") ||
    request.nextUrl.pathname.startsWith("/support") ||
    request.nextUrl.pathname.startsWith("/privacy") ||
    request.nextUrl.pathname.startsWith("/terms") ||
    request.nextUrl.pathname.startsWith("/api/strava/webhook") ||
    request.nextUrl.pathname.startsWith("/api/strava/prepare-public") ||
    request.nextUrl.pathname.startsWith("/api/strava/callback") ||
    request.nextUrl.pathname.startsWith("/_next") ||
    request.nextUrl.pathname.startsWith("/favicon");

  if (!user && !isPublicPath && !isApi) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Remember where they were headed so login can send them back.
    url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // MFA step-up: a user who has enrolled TOTP but only completed first-factor
  // auth (aal1) must verify a code before reaching any protected page. Users
  // without a factor have nextLevel === "aal1" and pass straight through.
  if (user && !isPublicPath && !isApi) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal1" && aal.nextLevel === "aal2") {
      const url = request.nextUrl.clone();
      url.pathname = "/mfa";
      url.search = "";
      url.searchParams.set("next", path + request.nextUrl.search);
      return NextResponse.redirect(url);
    }
  }

  // Role separation for logged-in users:
  //  - clients may only reach the portal (+ public paths like /auth/signout)
  //  - trainers have no business in the portal
  if (user && !isPublicPath && !isApi) {
    if (isClient && !inPortal) {
      const url = request.nextUrl.clone();
      url.pathname = "/portal";
      url.search = "";
      return NextResponse.redirect(url);
    }
    if (!isClient && inPortal) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

// Only allow relative, single-slash paths as redirect targets (no open redirects).
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
