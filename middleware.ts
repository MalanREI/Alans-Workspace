import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/reset-password", "/"];

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const pathname = req.nextUrl.pathname;

  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/site-reports/public");
  if (isPublic) return res;

  // Keep middleware edge-safe by checking for Supabase auth cookies only.
  const hasSupabaseSessionCookie = req.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token"));

  if (!hasSupabaseSessionCookie) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  // Temporary safety switch: disable middleware matching until edge runtime
  // compatibility issue is resolved in the deployment environment.
  matcher: ["/__middleware-disabled"],
};
