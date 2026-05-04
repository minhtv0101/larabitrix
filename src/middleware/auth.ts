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
    const apiKey = c.env.WORKER_API_KEY;
    // Fail secure: if secret was never provisioned, reject all requests rather than
    // letting timingSafeEqual encode "undefined" and accept `Bearer undefined`.
    if (!apiKey) {
      return c.json({ success: false, error: "service_unavailable" }, 503);
    }
    const header = c.req.header("Authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (
      scheme !== "Bearer" ||
      !token ||
      !timingSafeEqual(token, apiKey)
    ) {
      return c.json({ success: false, error: "unauthorized" }, 401);
    }
    await next();
  };
}
