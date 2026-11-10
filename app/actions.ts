"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asService } from "@/lib/db";
import { SESSION_COOKIE, sign, type Session } from "@/lib/session";
import { homeFor } from "@/lib/auth";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const user = await asService(async (c) => {
    const { rows } = await c.query<{ id: string; email: string; role: Session["role"]; contract_id: number | null }>(
      `select id, email, role, contract_id from users
       where email = $1 and password_hash = crypt($2, password_hash)`,
      [email, password],
    );
    return rows[0];
  });
  if (!user) redirect("/login?e=1");

  const session: Session = { uid: user.id, email: user.email, role: user.role, cid: user.contract_id };
  (await cookies()).set(SESSION_COOKIE, await sign(session, "12h"), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600,
  });
  redirect(homeFor(session));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
