import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_KEY, SUPABASE_READY, SUPABASE_URL } from "@/lib/supabase/env";

/**
 * Proxy (Next 16's middleware). Two jobs:
 *  1. Refresh the Supabase session cookie on every admin request so server
 *     components never render against an expired token.
 *  2. Optimistic gate on /admin — an unauthenticated visitor is bounced to the
 *     login page before the dashboard streams. Every action and page still
 *     re-checks admin rights server-side; this is convenience, not the wall.
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  if (!SUPABASE_READY) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isLogin = pathname === "/admin/login";

  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    const from = `${pathname}${search}`;
    if (from !== "/admin") url.searchParams.set("next", from);
    return NextResponse.redirect(url);
  }

  // `?denied=1` means a signed-in account without the admin role was bounced
  // here by requireAdmin — sending it back to /admin would loop forever.
  if (user && isLogin && !request.nextUrl.searchParams.has("denied")) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
