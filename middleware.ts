import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verify, type Session } from "@/lib/session";

// Coarse gate: no session -> login; wrong role -> own home. Pages re-check, and RLS is the real wall.
export async function middleware(req: NextRequest) {
  const s = await verify<Session>(req.cookies.get(SESSION_COOKIE)?.value);
  const path = req.nextUrl.pathname;
  if (!s) return NextResponse.redirect(new URL("/login", req.url));
  const need = path.startsWith("/authority") ? "authority" : "contractor";
  if (s.role !== need) {
    return NextResponse.redirect(new URL(s.role === "authority" ? "/authority" : "/site", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/site/:path*", "/authority/:path*"] };
