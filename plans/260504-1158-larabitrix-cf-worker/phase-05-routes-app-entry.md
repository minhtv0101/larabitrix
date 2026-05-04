---
phase: 5
title: "Routes & App Entry"
status: completed
effort: 2h
---

# Phase 5: Routes & App Entry

## Context Links

- Plan: [plan.md](./plan.md)
- Hono routing: https://hono.dev/docs/api/routing
- Hono error handling: https://hono.dev/docs/api/exception

## Overview

- Priority: P1 (final assembly)
- Status: Pending
- Wire HTTP routes for Lists + CRM, mount auth middleware globally, and define a single error handler that converts `BitrixApiError` to the standard envelope.

## Key Insights

- One Hono app with two sub-routers keeps file count low and route prefixes clear.
- Global `app.onError` is the only place errors should be serialized — handlers `throw`.
- Hono's `c.req.param("id")` is always string; cast/validate before passing to ORM.
- Standard response envelope: `{ success: true, data }` or `{ success: false, error, code? }`.

## Requirements

**Functional**
- Mount `auth` middleware on `/api/*`.
- Routes (all under `/api`):
  - `GET /lists/:id` → `paginate`. Query: `?page=1&filter[field]=value`.
  - `POST /lists/:id` → `updateOrCreate` if `?uniqueField=` present in body, else plain create (we route both via `updateOrCreate` when `uniqueField` provided in body; otherwise call a thin `create` wrapper that uses `lists.element.add`).
  - `PATCH /lists/:id/upsert/:field` → `updateOrCreate(env, id, field, body)`.
  - `PATCH /lists/:id/:itemId/math/:field` → `math(env, id, itemId, field, body.amount)`.
  - `DELETE /lists/:id/:itemId` → `hardDelete(env, id, itemId)`.
  - `DELETE /api/cache/:listId` → `invalidateSchema(env, listId)` — clears RAM + KV schema cache. <!-- Updated: Validation Session 1 -->
  - `PATCH /crm/contact/upsert/PHONE` → `upsertCrmEntity(env, 3, "PHONE", body.phone, body)`.
  - `PATCH /crm/company/upsert/UF_CRM_MST` → `upsertCrmEntity(env, 4, "UF_CRM_MST", body.uf_crm_mst, body)`.
  - `POST /crm/deal` → `createDeal(env, body)` — pass through `CONTACT_ID`, `COMPANY_ID` if present.
- All responses follow envelope.
- 4xx for client errors (validation), 5xx for upstream/Bitrix errors.

**Non-functional**
- Each route file <200 LOC.
- Zero business logic in route handlers — only param parsing + envelope wrapping.

## Architecture

```
src/index.ts
  └── new Hono<{ Bindings: Env }>()
       ├── app.use("/api/*", authMiddleware())
       ├── app.route("/api/lists", listsRouter)
       ├── app.route("/api/crm",   crmRouter)
       └── app.onError(toEnvelope)
```

```
Request → auth → router → handler → orm verb → envelope
                                              ↘ throw → onError → envelope
```

## Related Code Files

**Create**
- `src/routes/lists.ts`
- `src/routes/crm.ts`
- `src/index.ts`

**Read**
- `src/middleware/auth.ts`
- `src/services/orm.ts`
- `src/services/bitrix24-client.ts` (BitrixApiError)
- `src/types.ts`

**Modify** — none
**Delete** — none

## Implementation Steps

1. **`src/routes/lists.ts`**:
   - `const listsRouter = new Hono<{ Bindings: Env }>()`
   - `listsRouter.get("/:id", async c => { const page = Number(c.req.query("page") ?? 1); const filter = parseFilterFromQuery(c.req.queries()); const data = await paginate(c.env, c.req.param("id"), filter, page); return c.json({ success: true, data }) })`
   - Helper `parseFilterFromQuery(queries)`: read keys matching `filter[<name>]` (Hono `queries()` returns `Record<string, string[]>`); strip prefix; flatten to `{ name: value }`.
   - `POST /:id`: read JSON body; if `body.uniqueField` present → `updateOrCreate`; else → call `callApi("lists.element.add", { IBLOCK_TYPE_ID: "lists", IBLOCK_ID: id, ELEMENT_CODE, NAME, FIELDS: transformed })` via thin wrapper in `orm.ts` named `create`.
   - `PATCH /:id/upsert/:field`: body is JSON payload → `updateOrCreate(env, id, field, body)`.
   - `PATCH /:id/:itemId/math/:field`: body `{ amount: number }`. Validate `Number.isFinite(amount)`; reject 400 otherwise. → `math(...)`.
   - `DELETE /:id/:itemId`: → `hardDelete(env, id, itemId)`. <!-- Updated: Validation Session 1 -->
   - Export `listsRouter`.
2. **`src/routes/crm.ts`**:
   - `const crmRouter = new Hono<{ Bindings: Env }>()`
   - `PATCH /contact/upsert/PHONE`: body must include `phone`; validate non-empty → `upsertCrmEntity(env, 3, "PHONE", body.phone, body)`.
   - `PATCH /company/upsert/UF_CRM_MST`: body must include `uf_crm_mst`; → `upsertCrmEntity(env, 4, "UF_CRM_MST", body.uf_crm_mst, body)`.
   - `POST /deal`: body is fields → `createDeal(env, body)`.
   - Export `crmRouter`.
3. **`src/index.ts`**:
   - `const app = new Hono<{ Bindings: Env }>()`
   - `app.use("/api/*", authMiddleware())`
   - `app.route("/api/lists", listsRouter)`
   - `app.route("/api/crm", crmRouter)`
   - `app.get("/health", c => c.json({ success: true, data: { status: "ok" } }))` (unauth, before route mount? — mount before `app.use` OR add separate path; simpler: keep as `/health` and add `app.use` only on `/api/*` ⇒ `/health` already excluded ✔)
   - `app.onError((err, c) => { if (err instanceof BitrixApiError) return c.json({ success: false, error: err.message, code: err.code }, (err.httpStatus ?? 502) as any); console.error(err); return c.json({ success: false, error: "internal_error" }, 500); })`
   - `app.notFound(c => c.json({ success: false, error: "not_found" }, 404))`
   - `export default app`

## Todo List

- [x] `lists.ts` mounts all 5 endpoints (GET, POST, PATCH upsert, PATCH math, DELETE)
- [x] `crm.ts` mounts contact/company/deal
- [x] `index.ts` mounts auth on `/api/*` only (health stays public)
- [x] `DELETE /api/cache/:listId` route wired to `invalidateSchema`
- [x] All handlers wrap responses in `{ success, data }` envelope
- [x] `app.onError` translates `BitrixApiError` to `{ success: false, error, code }`
- [x] 400 returned for invalid `amount`, missing `phone`, missing `uf_crm_mst`
- [x] No business logic in handlers (delegate to ORM)
- [x] Each route file <200 LOC

## Success Criteria

- `GET /health` → 200 without auth.
- `GET /api/lists/123` without Bearer → 401.
- `GET /api/lists/123` with Bearer + valid Bitrix → 200 envelope with `data.items`.
- `PATCH /api/lists/123/456/math/counter` body `{ amount: 1 }` → 200 with `previous`/`current`.
- Invalid amount → 400 with `error: "invalid_amount"`.
- Bitrix 503 propagates as 503 envelope (after retries exhausted).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Filter query parsing accepts unsafe keys | Med | Med | Whitelist via schema; reject unknown |
| `app.onError` swallows stack traces in prod | Low | Low | `console.error(err)` so Cloudflare logs capture |
| Body parse fails silently | Med | Med | Wrap `await c.req.json()` in try/catch → 400 `invalid_json` |
| `app.use("/api/*")` order vs route registration | Low | High | Register middleware BEFORE `app.route` calls |

## Security Considerations

- Auth middleware applied before any route mount.
- `/health` deliberately public for uptime checks; returns no env data.
- Generic `internal_error` to client on unexpected throws (no stack leakage).

## Next Steps

- Phase 6 covers test matrix.

## Rollback

Delete the three new files plus revert `src/index.ts`. Worker stops responding; KV + Bitrix unaffected. `wrangler rollback` restores previous deployment in seconds.
