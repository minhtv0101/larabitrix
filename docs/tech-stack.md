# Tech Stack — Larabitrix

**Decided:** 2026-05-04 | Based on research reports in `plans/reports/`

## Runtime & Language

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Cloudflare Workers | Near-zero cold start, global edge, KV built-in |
| Language | TypeScript | Type-safe CF bindings, floating-promise detection, wrangler types |
| Compat flag | `nodejs_compat` | Latest CF runtime APIs |

## Framework & Libraries

| Purpose | Library | Version |
|---------|---------|---------|
| HTTP Router | [Hono](https://hono.dev) | v4 |
| No other runtime deps | — | (pure fetch + CF APIs) |

**Why Hono:** 402k ops/sec, built-in middleware, full TS inference, 12KB bundle — ideal for multi-route API gateway with auth + rate-limit middleware.

## Storage

| Store | Use Case | TTL |
|-------|----------|-----|
| Cloudflare KV | Bitrix24 schema cache (field→property maps) | 86400s |
| In-memory (module scope) | Per-isolate request-scope schema cache | Request lifetime |

Two-layer pattern: RAM hit → KV hit → Bitrix24 API fetch → write back.

## Testing

| Tool | Role |
|------|------|
| vitest | Test runner |
| @cloudflare/vitest-pool-workers | Runs tests inside workerd runtime (production parity) |

## Deployment

| Tool | Role |
|------|------|
| Wrangler CLI | Build, dev, deploy |
| wrangler.jsonc | Multi-env per client (one codebase, N workers) |

**Deploy pattern:** `wrangler deploy -e=client_a` — each client gets isolated Worker + KV namespace. Per-client secrets: `BITRIX_WEBHOOK_URL`, `WORKER_API_KEY`.

## Project Structure

```
src/
├── index.ts                    # Hono app init, Worker entry
├── routes/
│   ├── lists.ts                # /api/lists/:id/* handlers
│   └── crm.ts                  # /api/crm/:entity/* handlers
├── middleware/
│   ├── auth.ts                 # Bearer token validation
│   └── rate-limiter.ts         # 2 req/s sleep-based limiter
├── services/
│   ├── bitrix24-client.ts      # Fetch wrapper + retry/backoff
│   ├── schema-mapper.ts        # Dynamic field mapping + KV cache
│   └── orm.ts                  # upsert, math, softDelete, paginate
└── types.ts                    # Shared TS types + CF env bindings

wrangler.jsonc
vitest.config.ts
tsconfig.json
package.json
```

## Key Design Decisions

1. **Rate limit**: 550ms sleep between Bitrix API calls (< 2 req/s). Single-region deployment avoids distributed dedup complexity.
2. **Read-before-write**: Lists update always fetches existing record first; merges then sends full payload (Bitrix clears omitted fields).
3. **Schema cache invalidation**: 24h TTL (manual purge via `DELETE /cache/:listId` endpoint).
4. **CRM API**: Use `crm.item.list` (entityTypeId=3/4) — `crm.contact.list` is deprecated.
5. **Ghost webhook**: Return 200 immediately, process async via `ctx.waitUntil()`.
6. **Error format**: `{ success: bool, data?, error?, code? }` with standard HTTP status codes.
