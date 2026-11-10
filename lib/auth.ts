import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verify, type Session } from "./session";

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return verify<Session>(jar.get(SESSION_COOKIE)?.value);
}

export async function requireRole(role: Session["role"]): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.role !== role) redirect(homeFor(s));
  return s;
}

export function homeFor(s: Session): string {
  return s.role === "authority" ? "/authority" : "/site";
}
