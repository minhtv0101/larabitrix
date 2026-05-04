---
title: "Larabitrix - Cloudflare Worker Bitrix24 Middleware"
description: "API Gateway + ORM + Queue Handler on Cloudflare Workers between n8n/Wix and Bitrix24 CRM"
status: completed
priority: P1
effort: 13h
branch: main
tags: [backend, api, infra, feature]
created: 2026-05-04
---

# Larabitrix - Cloudflare Worker Bitrix24 Middleware

## Overview

TypeScript Cloudflare Worker (Hono v4) wrapping the Bitrix24 REST API with:
- Bearer-token auth gateway
- Dynamic Schema Mapper (auto-discovers Lists field IDs, slugifies names, caches in KV)
- ORM helpers: `updateOrCreate`, `math`, `softDelete`, `paginate`
- Read-before-write semantics for Lists (Bitrix clears omitted fields)
- Sleep-based rate limiter (550ms ≈ 2 req/s) + exponential backoff on 503/QUERY_LIMIT_EXCEEDED
- CRM upserts (Contact by PHONE, Company by UF_CRM_MST), Deal create
- Multi-client via Wrangler environments (one codebase, many deployments)

Out of scope (deferred): Ghost Webhook, Audit Trail, Data Aggregator, Virtual Fields.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Project Setup & Config](./phase-01-project-setup-config.md) | Completed |
| 2 | [Core Middleware & Bitrix24 Client](./phase-02-core-middleware-bitrix24-client.md) | Completed |
| 3 | [Dynamic Schema Mapper](./phase-03-dynamic-schema-mapper.md) | Completed |
| 4 | [ORM Engine](./phase-04-orm-engine.md) | Completed |
| 5 | [Routes & App Entry](./phase-05-routes-app-entry.md) | Completed |
| 6 | [Testing](./phase-06-testing.md) | Completed |

## Validation Log

### Session 1 — 2026-05-04
**Trigger:** Pre-implementation validation interview (5 questions)
**Questions asked:** 5

#### Questions & Answers

1. **[Architecture]** Rate limiting: multi-isolate risk — accept or coordinate?
   - Options: Accept risk (rely on Bitrix 503) | Durable Object coordinator
   - **Answer:** Accept risk — rely on Bitrix 503 + retry
   - **Rationale:** Keeps implementation simple; Bitrix 503 + backoff handles burst. Durable Objects deferred to v2.

2. **[Architecture]** Cache management: internal-only or expose DELETE endpoint?
   - Options: Add `DELETE /api/cache/:listId` | CLI-only via wrangler
   - **Answer:** Add DELETE /api/cache/:listId endpoint
   - **Impact on Phases:** Phase 5 — add route `DELETE /api/cache/:listId` calling `invalidateSchema(env, listId)`.

3. **[Architecture]** POST /lists/:id dual-behavior (body-driven upsert vs plain create)?
   - Options: Keep dual-behavior | POST always plain create
   - **Answer:** Keep dual-behavior (body-driven)
   - **Rationale:** Flexible for n8n/Wix callers; no change needed.

4. **[Assumptions]** Auth model: one key per client or multiple keys?
   - Options: One WORKER_API_KEY per env | Multiple keys per client
   - **Answer:** One key per client deployment
   - **Rationale:** Simple rotation via `wrangler secret put`; no extra store needed.

5. **[Architecture]** softDelete: ACTIVE=N fallback or hard delete?
   - Options: Fallback to ACTIVE=N | Always require is_deleted | Hard delete
   - **Answer:** Hard delete — use `lists.element.delete` instead
   - **Impact on Phases:** Phase 4 — replace `softDelete` with `hardDelete`. Phase 5 — change endpoint from `PATCH /:id/:itemId/soft-delete` → `DELETE /:id/:itemId`.

#### Confirmed Decisions
- Rate limiting: per-isolate sleep only; Bitrix 503 is the safety net
- Schema cache: expose `DELETE /api/cache/:listId` (auth-protected)
- POST /lists dual-behavior: kept as-is
- Auth: single WORKER_API_KEY per Wrangler environment
- Delete: hard delete (`lists.element.delete`), not soft delete

#### Action Items
- [x] Phase 4: Replace `softDelete` → `hardDelete` using `lists.element.delete`
- [x] Phase 5: Change `PATCH /:id/:itemId/soft-delete` → `DELETE /:id/:itemId`
- [x] Phase 5: Add `DELETE /api/cache/:listId` route

## Dependencies

- Bitrix24 inbound webhook URL (per client) with scopes: `lists`, `crm`
- Cloudflare account with Workers + KV enabled
- Wrangler CLI installed locally; `WORKER_API_KEY` and `BITRIX_WEBHOOK_URL` provisioned as Wrangler secrets per env
- Phase order is strict: 1 → 2 → 3 → 4 → 5 → 6 (each phase consumes prior outputs)
