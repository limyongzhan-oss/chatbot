import { SignJWT, jwtVerify, type JWTPayload } from "jose";

// Edge-safe (used by middleware too).
// Resolved lazily so `next build` works without secrets. In production a missing or short
// secret is a hard error: the dev fallback is public, so it would let anyone forge a login.
let cached: Uint8Array | undefined;
function secret(): Uint8Array {
  if (cached) return cached;
  const s = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production" && (!s || s.length < 32)) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters in production");
  }
  return (cached = new TextEncoder().encode(s ?? "dtbm-dev-only-secret-do-not-use-in-prod"));
}

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
    .sign(secret());
}

export async function verify<T>(token: string | undefined): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as T;
  } catch {
    return null;
  }
}
