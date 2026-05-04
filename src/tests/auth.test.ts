import { describe, it, expect, vi } from "vitest";
import app from "../index";
import { makeTestEnv } from "./_helpers";

vi.mock("../middleware/rate-limiter", () => ({
  sleep: () => Promise.resolve(),
  RATE_LIMIT_DELAY_MS: 0,
}));

describe("GET /health (public)", () => {
  it("returns 200 without auth", async () => {
    const res = await app.request("/health", {}, makeTestEnv());
    expect(res.status).toBe(200);
    const body = await res.json<{ success: boolean }>();
    expect(body.success).toBe(true);
  });
});

describe("Auth middleware on /api/*", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await app.request("/api/lists/123", {}, makeTestEnv());
    expect(res.status).toBe(401);
    const body = await res.json<{ success: boolean; error: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 when scheme is not Bearer", async () => {
    const res = await app.request(
      "/api/lists/123",
      { headers: { Authorization: "Basic test-api-key" } },
      makeTestEnv()
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is wrong", async () => {
    const res = await app.request(
      "/api/lists/123",
      { headers: { Authorization: "Bearer wrong-token" } },
      makeTestEnv()
    );
    expect(res.status).toBe(401);
  });

  it("passes auth and reaches route with correct token", async () => {
    // Route will fail (no Bitrix mock), but auth must pass — status ≠ 401
    const res = await app.request(
      "/api/lists/123",
      { headers: { Authorization: "Bearer test-api-key" } },
      makeTestEnv()
    );
    expect(res.status).not.toBe(401);
  });
});
