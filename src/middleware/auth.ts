import type { MiddlewareHandler } from "hono";
import type { Env } from "../types";

/** XOR-based constant-time string comparison (prevents timing oracle). */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export function authMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (
      scheme !== "Bearer" ||
      !token ||
      !timingSafeEqual(token, c.env.WORKER_API_KEY)
    ) {
      return c.json({ success: false, error: "unauthorized" }, 401);
    }
    await next();
  };
}
