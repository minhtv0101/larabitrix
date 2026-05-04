import { Hono } from "hono";
import type { Env } from "../types";
import {
  paginate,
  getById,
  create,
  updateOrCreate,
  math,
  hardDelete,
} from "../services/orm-lists";
import { invalidateSchema } from "../services/schema-mapper";

export const listsRouter = new Hono<{ Bindings: Env }>();

/** Parses `filter[field]=value` query params into a clean key map. */
function parseFilterFromQuery(absoluteUrl: string): Record<string, string> {
  const filter: Record<string, string> = {};
  try {
    const { searchParams } = new URL(absoluteUrl);
    for (const [key, value] of searchParams.entries()) {
      const match = key.match(/^filter\[(.+)\]$/);
      if (match?.[1]) filter[match[1]] = value;
    }
  } catch {
    // malformed URL — return empty filter
  }
  return filter;
}

// GET /api/lists/:id?page=1&filter[field]=value
listsRouter.get("/:id", async (c) => {
  const iblockId = c.req.param("id");
  const page = Number(c.req.query("page") ?? 1);
  const filter = parseFilterFromQuery(c.req.raw.url);
  const data = await paginate(c.env, iblockId, filter, page);
  return c.json({ success: true, data });
});

// GET /api/lists/:id/:itemId — lấy một item theo ID
listsRouter.get("/:id/:itemId", async (c) => {
  const iblockId = c.req.param("id");
  const itemId = c.req.param("itemId");
  const data = await getById(c.env, iblockId, itemId);
  return c.json({ success: true, data });
});

// POST /api/lists/:id — plain create OR upsert when body.uniqueField present
listsRouter.post("/:id", async (c) => {
  const iblockId = c.req.param("id");
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ success: false, error: "invalid_json" }, 400);
  }

  const uniqueField = body["uniqueField"] as string | undefined;
  const data = uniqueField
    ? await updateOrCreate(c.env, iblockId, uniqueField, body)
    : await create(c.env, iblockId, body);
  return c.json({ success: true, data });
});

// PATCH /api/lists/:id/upsert/:field
listsRouter.patch("/:id/upsert/:field", async (c) => {
  const iblockId = c.req.param("id");
  const field = c.req.param("field");
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ success: false, error: "invalid_json" }, 400);
  }
  const data = await updateOrCreate(c.env, iblockId, field, body);
  return c.json({ success: true, data });
});

// PATCH /api/lists/:id/:itemId/math/:field
listsRouter.patch("/:id/:itemId/math/:field", async (c) => {
  const iblockId = c.req.param("id");
  const itemId = c.req.param("itemId");
  const field = c.req.param("field");
  let body: { amount?: unknown };
  try {
    body = await c.req.json<{ amount?: unknown }>();
  } catch {
    return c.json({ success: false, error: "invalid_json" }, 400);
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount)) {
    return c.json({ success: false, error: "invalid_amount" }, 400);
  }
  const data = await math(c.env, iblockId, itemId, field, amount);
  return c.json({ success: true, data });
});

// DELETE /api/lists/:id/:itemId
listsRouter.delete("/:id/:itemId", async (c) => {
  const iblockId = c.req.param("id");
  const itemId = c.req.param("itemId");
  const data = await hardDelete(c.env, iblockId, itemId);
  return c.json({ success: true, data });
});

// DELETE /api/cache/:listId — schema cache invalidation (auth-protected via parent)
export const cacheRouter = new Hono<{ Bindings: Env }>();
cacheRouter.delete("/:listId", async (c) => {
  const listId = c.req.param("listId");
  await invalidateSchema(c.env, listId);
  return c.json({ success: true, data: { listId, invalidated: true } });
});
