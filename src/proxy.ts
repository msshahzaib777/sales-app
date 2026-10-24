import { type NextRequest, NextResponse } from "next/server";

// Optimistic check only: sends visitors without a session cookie to the login page. The real
// check (valid token, active user, tenant, permissions) happens in src/server/auth/session.ts.

const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];
const PUBLIC_PATHS = ["/login", "/api/auth"];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!hasSession) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico)$).*)"],
};
