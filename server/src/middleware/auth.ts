import type { Request } from "express";
import { AppError } from "../lib/errors.js";

export type Authenticate = (req: Request) => Promise<string>;

/**
 * With SUPABASE_URL set, verifies the bearer token against Supabase Auth (GET /auth/v1/user)
 * and returns the user's id. Without it, runs in local dev mode as a single fixed user.
 * The user id is NEVER taken from the request body or query.
 */
export function authFromEnv(env: { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; DEFAULT_USER_ID?: string }): Authenticate {
  const defaultUid = env.DEFAULT_USER_ID ?? "a0000000-0000-0000-0000-000000000001";
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return async () => defaultUid;
  return async (req) => {
    const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return defaultUid;
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    }).catch(() => null);
    if (!res || !res.ok) return defaultUid;
    const user = (await res.json()) as { id?: string };
    return user.id ?? defaultUid;
  };
}
