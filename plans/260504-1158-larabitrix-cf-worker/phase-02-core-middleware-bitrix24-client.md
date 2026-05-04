---
phase: 2
title: "Core Middleware & Bitrix24 Client"
status: completed
effort: 2h
---

# Phase 2: Core Middleware & Bitrix24 Client

## Context Links

- Plan: [plan.md](./plan.md)
- Bitrix24 rate limit doc: https://apidocs.bitrix24.com/limits.html
- Hono middleware: https://hono.dev/docs/guides/middleware

## Overview

- Priority: P1 (blocks Phases 3–5)
- Status: Pending
- Build the Bearer-auth middleware, the rate-limiter sleep utility, and the Bitrix24 HTTP client wrapper with retry/backoff.

## Key Insights

- Bitrix24 throttle response is **HTTP 503 + body `error: "QUERY_LIMIT_EXCEEDED"`**, NOT 429. Header `operating_reset_at` (epoch seconds) hints when to retry.
- 2 req/s ⇒ minimum 500ms gap; 550ms gives a safety margin.
- Cloudflare Workers `setTimeout` is allowed inside fetch handlers; no need for `scheduled`.
- Hono `c.env` is the typed `Env` from Phase 1 — pass via generic `new Hono<{ Bindings: Env }>()`.
- A single in-memory throttle is per-isolate; CF Workers spawn many isolates so 2 req/s is best-effort, not strict — Bitrix's own 503 is the authoritative limit.

## Requirements

**Functional**
- `auth` middleware rejects requests missing/invalid `Authorization: Bearer <WORKER_API_KEY>` with 401 + `{ success: false, error: "unauthorized" }`.
- `sleep(ms)` utility used by client to gate every outbound Bitrix call.
- `callApi(env, method, params)`:
  - sleeps 550ms before each call
  - POSTs `${BITRIX_WEBHOOK_URL}/${method}` with JSON body
  - returns `result` field on success
  - on 503 + `QUERY_LIMIT_EXCEEDED` OR 5xx: retries with backoff `1s, 2s, 4s` (max 3 attempts total)
  - on Bitrix `error` field set in 200 body: throw with code + description
  - on final failure: throws `BitrixApiError`

**Non-functional**
- Zero deps beyond Hono + workers-types.
- Each file under 200 LOC.

## Architecture

```
Request ─► Hono ─► auth.ts (Bearer check) ─► route handler ─► orm.ts (Phase 4)
                                                                  │
                                                                  ▼
                                                         bitrix24-client.ts
                                                                  │
                                                                  ▼
                                                       sleep 550ms ─► fetch(BITRIX)
                                                                  │
                                                       503/5xx ──► backoff retry ×3
                                                                  │
                                                                  ▼
                                                            return result
```

## Related Code Files

**Create**
- `src/middleware/auth.ts`
- `src/middleware/rate-limiter.ts` (exports `sleep`)
- `src/services/bitrix24-client.ts` (exports `callApi`, `BitrixApiError`)

**Read** — `src/types.ts`
**Modify** — none
**Delete** — none

## Implementation Steps

1. `src/middleware/rate-limiter.ts`:
   - `export const RATE_LIMIT_DELAY_MS = 550;`
   - `export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));`
2. `src/middleware/auth.ts`:
   - Hono middleware factory `authMiddleware()`.
   - Read `c.req.header("Authorization")`; split on space; compare second segment to `c.env.WORKER_API_KEY` using constant-time compare (loop with XOR over equal-length strings).
   - If mismatch or missing: `return c.json({ success: false, error: "unauthorized" }, 401)`.
   - `await next()`.
3. `src/services/bitrix24-client.ts`:
   - `export class BitrixApiError extends Error { constructor(public code: string, message: string, public httpStatus?: number) { super(message) } }`
   - `export async function callApi<T = unknown>(env: Env, method: string, params: Record<string, unknown> = {}): Promise<T>`
   - Inside: loop attempts 1..3
     - `await sleep(RATE_LIMIT_DELAY_MS)`
     - `const url = \`${env.BITRIX_WEBHOOK_URL.replace(/\/$/, "")}/${method}.json\``
     - `fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) })`
     - if `res.status === 503` OR `res.status >= 500`: backoff `2 ** attempt * 1000` ms, continue loop
     - parse JSON; if `body.error`: throw `BitrixApiError(body.error, body.error_description, res.status)` (do NOT retry on logical errors)
     - return `body.result`
   - After loop exhausted: throw `BitrixApiError("rate_limit_exhausted", "max retries reached", 503)`

## Todo List

- [x] `rate-limiter.ts` with `sleep` + `RATE_LIMIT_DELAY_MS`
- [x] `auth.ts` middleware with constant-time compare
- [x] `bitrix24-client.ts` with `callApi` + `BitrixApiError`
- [x] Retry/backoff loop covers 503 + 5xx
- [x] Logical errors (Bitrix `error` body) NOT retried
- [x] Files <200 LOC each
- [x] `npm run typecheck` passes

## Success Criteria

- `auth` middleware rejects 3 cases: no header, wrong scheme, wrong token.
- `callApi` returns parsed `result` on 200.
- `callApi` retries exactly 3 times on persistent 503 then throws `rate_limit_exhausted`.
- `callApi` does NOT retry on `body.error = "INVALID_REQUEST"`.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Per-isolate sleep insufficient under burst | Med | Med | Bitrix's own 503 + backoff is authoritative safety net |
| Backoff cascade exhausts CPU time budget | Low | High | Cap retries at 3; max sleep 4s; fail loudly |
| Constant-time compare wrong shape (length leak) | Low | Med | Pad both sides to same length before XOR; document |
| Webhook URL trailing slash double-slashes path | Med | Low | Normalize via `.replace(/\/$/, "")` |

## Security Considerations

- Constant-time auth compare to defend against timing oracles.
- Never log `Authorization` header or webhook URL in errors.
- Errors returned to caller scrub Bitrix internal codes through allow-list of known codes.

## Next Steps

- Phase 3 (`schema-mapper`) calls `callApi(env, "lists.field.get", ...)`.
- Phase 4 (`orm`) is the primary consumer.

## Rollback

Delete the three new files. No state mutated; no external resource provisioned.
