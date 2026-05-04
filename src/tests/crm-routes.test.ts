import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import app from "../index";
import {
  mockFetch,
  bitrixOk,
  bitrix503,
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

beforeEach(() => {
  e = makeTestEnv();
});

afterEach(() => {
  restoreFetch?.();
});

describe("PATCH /api/crm/contact/upsert/PHONE", () => {
  it("returns 400 when phone is missing", async () => {
    const res = await app.request(
      "/api/crm/contact/upsert/PHONE",
      {
        method: "PATCH",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ NAME: "No phone" }),
      },
      e
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("missing_phone");
  });

  it("creates contact when PHONE not found (action: created)", async () => {
    restoreFetch = mockFetch((url) => {
      if (url.includes("crm.item.list")) return bitrixOk({ items: [] });
      if (url.includes("crm.item.add")) return bitrixOk({ item: { id: 10 } });
      return bitrixOk(null);
    });
    const res = await app.request(
      "/api/crm/contact/upsert/PHONE",
      {
        method: "PATCH",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+84900000000", NAME: "New Contact" }),
      },
      e
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { action: string; id: number } }>();
    expect(body.data.action).toBe("created");
    expect(body.data.id).toBe(10);
  });

  it("updates contact when PHONE already exists (action: updated)", async () => {
    restoreFetch = mockFetch((url) => {
      if (url.includes("crm.item.list")) return bitrixOk({ items: [{ id: 7 }] });
      if (url.includes("crm.item.update")) return bitrixOk({ item: { id: 7 } });
      return bitrixOk(null);
    });
    const res = await app.request(
      "/api/crm/contact/upsert/PHONE",
      {
        method: "PATCH",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+84900000000", NAME: "Updated" }),
      },
      e
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { action: string; id: number } }>();
    expect(body.data.action).toBe("updated");
    expect(body.data.id).toBe(7);
  });
});

describe("PATCH /api/crm/company/upsert/UF_CRM_MST", () => {
  it("returns 400 when uf_crm_mst is missing", async () => {
    const res = await app.request(
      "/api/crm/company/upsert/UF_CRM_MST",
      {
        method: "PATCH",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ TITLE: "No MST" }),
      },
      e
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("missing_uf_crm_mst");
  });

  it("creates company when MST not found", async () => {
    restoreFetch = mockFetch((url) => {
      if (url.includes("crm.item.list")) return bitrixOk({ items: [] });
      if (url.includes("crm.item.add")) return bitrixOk({ item: { id: 20 } });
      return bitrixOk(null);
    });
    const res = await app.request(
      "/api/crm/company/upsert/UF_CRM_MST",
      {
        method: "PATCH",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ uf_crm_mst: "123456789", TITLE: "ACME" }),
      },
      e
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { action: string } }>();
    expect(body.data.action).toBe("created");
  });
});

describe("POST /api/crm/deal", () => {
  it("creates deal with CONTACT_ID and COMPANY_ID", async () => {
    restoreFetch = mockFetch((url, init) => {
      if (url.includes("crm.item.add")) {
        const body = JSON.parse((init.body as string) ?? "{}") as Record<string, unknown>;
        expect(body["entityTypeId"]).toBe(2);
        const fields = body["fields"] as Record<string, unknown>;
        expect(fields["CONTACT_ID"]).toBe(5);
        expect(fields["COMPANY_ID"]).toBe(3);
        return bitrixOk({ item: { id: 99 } });
      }
      return bitrixOk(null);
    });
    const res = await app.request(
      "/api/crm/deal",
      {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ TITLE: "New Deal", CONTACT_ID: 5, COMPANY_ID: 3 }),
      },
      e
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: { id: number } }>();
    expect(body.data.id).toBe(99);
  });
});

describe("Persistent Bitrix 503 on CRM route", () => {
  it("returns error envelope after retries exhausted", async () => {
    restoreFetch = mockFetch(() => bitrix503());
    const res = await app.request(
      "/api/crm/contact/upsert/PHONE",
      {
        method: "PATCH",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+84900000000" }),
      },
      e
    );
    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = await res.json<{ success: boolean }>();
    expect(body.success).toBe(false);
  });
});
