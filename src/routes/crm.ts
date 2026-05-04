import { Hono } from "hono";
import type { Env } from "../types";
import { upsertCrmEntity, createDeal } from "../services/orm-crm";

export const crmRouter = new Hono<{ Bindings: Env }>();

// PATCH /api/crm/contact/upsert/PHONE
crmRouter.patch("/contact/upsert/PHONE", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ success: false, error: "invalid_json" }, 400);
  }
  const phone = body["phone"] as string | undefined;
  if (!phone) {
    return c.json({ success: false, error: "missing_phone" }, 400);
  }
  // entityTypeId 3 = Contact
  const data = await upsertCrmEntity(c.env, 3, "PHONE", phone, body);
  return c.json({ success: true, data });
});

// PATCH /api/crm/company/upsert/UF_CRM_MST
crmRouter.patch("/company/upsert/UF_CRM_MST", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ success: false, error: "invalid_json" }, 400);
  }
  const mst = body["uf_crm_mst"] as string | undefined;
  if (!mst) {
    return c.json({ success: false, error: "missing_uf_crm_mst" }, 400);
  }
  // entityTypeId 4 = Company
  const data = await upsertCrmEntity(c.env, 4, "UF_CRM_MST", mst, body);
  return c.json({ success: true, data });
});

// POST /api/crm/deal
crmRouter.post("/deal", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ success: false, error: "invalid_json" }, 400);
  }
  const data = await createDeal(c.env, body);
  return c.json({ success: true, data });
});
