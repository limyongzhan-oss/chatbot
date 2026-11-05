import { SignJWT, jwtVerify, type JWTPayload } from "jose";

// Edge-safe (used by middleware too).
const secret = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "dtbm-dev-only-secret-do-not-use-in-prod",
);

export const SESSION_COOKIE = "dtbm_session";

export type Session = {
  uid: string;
  email: string;
  role: "authority" | "contractor";
  cid: number | null;
};

export async function sign(payload: JWTPayload, ttl: string): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret);
}

export async function verify<T>(token: string | undefined): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as T;
  } catch {
    return null;
  }
}
