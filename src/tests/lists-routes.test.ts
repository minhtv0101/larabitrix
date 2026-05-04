import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import app from "../index";
import { invalidateSchema } from "../services/schema-mapper";
import {
  mockFetch,
  bitrixOk,
  bitrix503,
  fixtureFieldsResponse,
  fixtureElement,
  makeTestEnv,
  TEST_API_KEY,
} from "./_helpers";
import type { Env } from "../types";

vi.mock("../middleware/rate-limiter", () => ({
  sleep: () => Promise.resolve(),
  RATE_LIMIT_DELAY_MS: 0,
}));

let e: Env;
let restoreFetch: () => void;

const authHeader = { Authorization: `Bearer ${TEST_API_KEY}` };

beforeEach(async () => {
  e = makeTestEnv();
  await invalidateSchema(e, "42");
});

afterEach(() => {
  restoreFetch?.();
});

function schemaFirst(...rest: Response[]): void {
  const responses = [bitrixOk(fixtureFieldsResponse()), ...rest];
  let i = 0;
  restoreFetch = mockFetch(() => {
    const r = responses[i] ?? responses[responses.length - 1];
    if (i < responses.length - 1) i++;
    return r!;
  });
}

describe("GET /api/lists/42", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/lists/42", {}, e);
    expect(res.status).toBe(401);
  });

  it("returns 200 with items envelope", async () => {
    schemaFirst(bitrixOk([fixtureElement("1", "+84", "note", 0)]));
    const res = await app.request("/api/lists/42", { headers: authHeader }, e);
    expect(res.status).toBe(200);
    const body = await res.json<{ success: boolean; data: { items: unknown[] } }>();
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
  });
});

describe("PATCH /api/lists/42/upsert/phone", () => {
  it("returns action in response", async () => {
    schemaFirst(bitrixOk([]), bitrixOk("99")); // empty search → create
    const res = await app.request(
      "/api/lists/42/upsert/phone",
      {
        method: "PATCH",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+84999" }),
      },
      e
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ success: boolean; data: { action: string } }>();
    expect(body.data.action).toBe("created");
  });
});

describe("PATCH /api/lists/42/:itemId/math/:field", () => {
  it("returns previous and current values", async () => {
    const existing = fixtureElement("7", "+84", "n", 5);
    schemaFirst(bitrixOk([existing]), bitrixOk(true));
    const res = await app.request(
      "/api/lists/42/7/math/counter",
      {
        method: "PATCH",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 3 }),
      },
      e
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { previous: number; current: number } }>();
    expect(body.data.previous).toBe(5);
    expect(body.data.current).toBe(8);
  });

  it("returns 400 for non-numeric amount", async () => {
    const res = await app.request(
      "/api/lists/42/7/math/counter",
      {
        method: "PATCH",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: "bad" }),
      },
      e
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("invalid_amount");
  });
});

describe("DELETE /api/lists/42/55", () => {
  it("returns deleted: true", async () => {
    restoreFetch = mockFetch(() => bitrixOk(true));
    const res = await app.request(
      "/api/lists/42/55",
      { method: "DELETE", headers: authHeader },
      e
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { deleted: boolean } }>();
    expect(body.data.deleted).toBe(true);
  });
});

describe("Persistent Bitrix 503", () => {
  it("returns 503 envelope after retries exhausted", async () => {
    restoreFetch = mockFetch(() => bitrix503());
    const res = await app.request(
      "/api/lists/42",
      { headers: authHeader },
      e
    );
    // After 3 retries, BitrixApiError rate_limit_exhausted → 503
    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = await res.json<{ success: boolean }>();
    expect(body.success).toBe(false);
  });
});
