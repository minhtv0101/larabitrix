# Cloudflare Workers REST API Middleware: Production Best Practices

**Project:** Larabitrix (Bitrix24 API Gateway on CF Workers)  
**Date:** 2026-05-04  
**Research Scope:** TypeScript vs JS, routing, KV caching, error handling, testing, structure, multi-env deployment

---

## 1. TypeScript vs JavaScript

**RECOMMENDATION: TypeScript (mandatory for production)**

**Why:**
- Full type safety for Cloudflare binding APIs (KV, D1, R2, Queues, RPC)—types generated from workerd runtime
- Prevents floating promise bugs (unresolved async operations)—enable `@typescript-eslint/no-floating-promises`
- wrangler types auto-generates runtime types matching your compatibility date; JS loses this benefit

**Trade-off:** 1-2KB bundle size increase vs. eliminated entire classes of runtime bugs

---

## 2. Routing: Hono vs itty-router vs Native URL Parsing

**RECOMMENDATION: Hono for REST API middleware; itty-router only if bundle size critical**

| Dimension | Hono | itty-router | Native URL |
|-----------|------|-------------|-----------|
| **Bundle Size** | ~12KB | ~500B | 0B (stdlib) |
| **Performance** | 402k ops/sec | 212k ops/sec | Slower |
| **Middleware** | Built-in | None | Manual |
| **TypeScript Inference** | Full | None | Partial |
| **Error Handling** | Built-in | Manual | Manual |
| **Weekly Downloads** | 1.8M | 200K | N/A |

**Decision Tree:**
- **Choose Hono** if: REST API with middleware, validation, standardized error handling needed (your use case)
- **Choose itty-router** if: Ultra-lean gateway with <5 routes, no middleware
- **Choose Native** if: Extreme cost sensitivity (pay per CPU-ms)

For Larabitrix (multi-route schema mapper + rate limiter), **Hono wins**—12KB is negligible in a Worker, and middleware cuts custom code significantly.

---

## 3. Cloudflare KV Caching Strategy

**Pattern: Two-Layer with Fallback + TTL Mastery**

```
Request → RAM cache (Request scope) 
        → KV cache (global, cacheTtl=60s default)
        → Miss? Fetch from Bitrix24 API
        → Write back to KV + RAM
```

**Best Practices:**
- **cacheTtl (important)**: Controls local edge replication speed. Default 60s. Increase to 300s for slow-read keys (schema definitions). Precedence: explicit expiration > cacheTtl.
- **TTL expiration**: Use relative (seconds) not absolute UNIX timestamps unless known at write time
- **Value sizing**: Keep <100KB for Larabitrix (schema cache, rate limit counters)
- **Batch writes**: Use `.put()` for single keys; bulk `.putMultiple()` for setup
- **Kinsta case study**: 30s TTL → 80% ops reduction; cache hit rate +56%

**Applied to Larabitrix:**
- Schema cache (Bitrix CRM fields): TTL = 86400s (1 day), high cacheTtl (300s)
- Rate limit counters: TTL = 3600s, low cacheTtl (10s) for accuracy
- Contact dedupe locks: TTL = 120s, cacheTtl = 5s (must be fresh)

---

## 4. Error Handling & HTTP Status Standards

**Standard Response Format (Hono):**
```typescript
// Success (200-299)
return c.json({ data: payload }, 200)

// Client error (400-499)
// 400: invalid request | 401: unauthorized | 403: forbidden | 404: not found | 409: conflict (rate limit)
return c.json({ error: "Rate limit exceeded", retry_after: 60 }, 409)

// Server error (500-599)
// 500: internal error | 503: service unavailable
return c.json({ error: "Bitrix24 API error" }, 503)
```

**Logging:** Structured JSON with console.log—parsed automatically in Workers Observability dashboard
```typescript
console.error(JSON.stringify({ 
  event: "bitrix_api_error",
  status: 503,
  request_id: crypto.randomUUID()
}))
```

**Floating Promises:** Avoid silent failures—always await or `ctx.waitUntil()`
```typescript
// Bad: promise fires but never completes before isolate terminates
notify_slack(error)

// Good: queued for background execution
ctx.waitUntil(notify_slack(error))
```

---

## 5. Testing: vitest + @cloudflare/vitest-pool-workers

**Setup (3 steps):**
1. Install: `npm i -D vitest @cloudflare/vitest-pool-workers`
2. Configure vitest.config.ts with cloudflareTest() plugin
3. Tests run inside workerd runtime (same as production)

**Test Types:**
- **Unit tests**: Route handlers, schema mapping logic
- **Integration tests**: Mock KV bindings (provided by pool)
- **Binding tests**: Full KV, D1, Queues access in test environment

**Example:**
```typescript
import { test, expect } from "vitest"
import { SCHEMA_KV } from "./schema.test.ts"

test("schema cache hit", async () => {
  await SCHEMA_KV.put("contact", { fields: [...] })
  const result = await getSchema("contact")
  expect(result.fields).toBeDefined()
})
```

**Speed:** workerd-based tests faster than Jest (no Node.js isolation overhead)

---

## 6. Project Structure: Multiple Route Handlers

**Recommended Structure (YAGNI):**
```
src/
├── index.ts                 # Worker entry, Hono app init
├── routes/
│   ├── schema.ts           # GET /schema/:entity
│   ├── create.ts           # POST /:entity (upsert)
│   └── read.ts             # GET /:entity/:id
├── middleware/
│   ├── auth.ts             # Bearer token validation
│   ├── rate-limit.ts       # 2 req/sec limiter
│   └── schema-mapper.ts    # Bitrix24 schema transform
├── services/
│   ├── bitrix24-client.ts  # HTTP client
│   └── kv-cache.ts         # KV + RAM cache layer
└── types.ts                # Shared TypeScript types

wrangler.jsonc              # Env-specific config
```

**Key Decisions:**
- `routes/` = HTTP handlers only (thin layer)
- `services/` = Business logic (schema mapping, API calls)
- `middleware/` = Cross-cutting concerns
- Max 150 lines per file—split if exceeded

---

## 7. Wrangler Multi-Environment Deployment

**Model: Single Codebase → Multiple Clients (Environments)**

```toml
# wrangler.jsonc
name = "larabitrix"
main = "src/index.ts"

[env.client_a]
  route = "api.clienta.example.com/api/*"
  kv_namespaces = [{ binding = "SCHEMA_KV", id = "kv_a_123" }]
  env = { CLIENT_ID = "a", BITRIX_DOMAIN = "clienta.bitrix24.com" }

[env.client_b]
  route = "api.clientb.example.com/api/*"
  kv_namespaces = [{ binding = "SCHEMA_KV", id = "kv_b_456" }]
  env = { CLIENT_ID = "b", BITRIX_DOMAIN = "clientb.bitrix24.com" }
```

**Deploy:**
```bash
wrangler deploy -e=client_a    # Deploy larabitrix-client_a
wrangler deploy -e=client_b    # Deploy larabitrix-client_b
```

**Non-inheritable per-env:** Bindings, env vars, routes. Define in each environment block.  
**Inherited from top-level:** Compatibility date, build settings.

**For Larabitrix:** Store per-client Bitrix domain in env var (not code). KV namespace IDs differ per client.

---

## 8. Performance & Security Checklist

- [ ] Enable `nodejs_compat` for latest runtime features
- [ ] Use `crypto.randomUUID()` for request IDs (not Math.random())
- [ ] Set `compatibility_date` to current date (updates runtime APIs)
- [ ] Stream responses for large payloads (avoid 128MB limit)
- [ ] Set KV cacheTtl > 0 for cold-read optimization
- [ ] Use structured JSON logging (console.log)
- [ ] No module-level request state (isolate reuse causes leaks)
- [ ] Enable Workers Observability before production

---

## Summary & Ranking

| Question | Answer | Confidence | Risk |
|----------|--------|------------|------|
| 1. TS vs JS | TypeScript mandatory | High | Low (standard practice) |
| 2. Routing | Hono for REST | High | Medium (ecosystem shifting) |
| 3. KV Strategy | 2-layer with cacheTtl=300s | High | Low (battle-tested pattern) |
| 4. Error Handling | 400/500 split + structured logs | High | Low (standard HTTP) |
| 5. Testing | vitest + pool-workers | High | Low (official tooling) |
| 6. Project Structure | routes/middleware/services split | Medium | Low (YAGNI-aligned) |
| 7. Multi-Env | Wrangler environments block | High | Low (native CF feature) |

---

## Unresolved Questions

1. **Bitrix24 rate limit coordination**: Does Larabitrix need distributed request deduplication across multiple worker instances? (Current 2 req/sec limiter assumes single edge location.)
2. **Schema cache invalidation**: Manual TTL expiration or webhook-triggered purge from Bitrix24 admin panel?
3. **KV failover strategy**: What happens if KV is unreachable during writes? Queue to Durable Objects or fail fast?
4. **n8n/Wix integration auth**: Bearer tokens—should be per-client, per-workflow, or global? Affects secret rotation complexity.

---

## Sources

- [Cloudflare Workers TypeScript Documentation](https://developers.cloudflare.com/workers/languages/typescript/)
- [Workers Best Practices Guide](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Hono Web Framework](https://hono.dev/docs)
- [itty-router on GitHub](https://github.com/kwhitley/itty-router)
- [Hono vs itty-router Comparison](https://www.pkgpulse.com/blog/hono-vs-itty-router-2026)
- [Cloudflare KV Documentation](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
- [KV Caching Best Practices](https://oneuptime.com/blog/post/2026-01-27-cloudflare-workers-kv/)
- [Error Handling in Workers](https://developers.cloudflare.com/workers/observability/errors/)
- [Vitest Integration for Workers](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Workers Vitest Blog Post](https://blog.cloudflare.com/workers-vitest-integration/)
- [Wrangler Environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Multi-Workers Development](https://developers.cloudflare.com/workers/development-testing/multi-workers/)
