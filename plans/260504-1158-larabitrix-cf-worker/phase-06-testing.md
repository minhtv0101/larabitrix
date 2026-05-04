---
phase: 6
title: "Testing"
status: completed
effort: 3h
---

# Phase 6: Testing

## Context Links

- Plan: [plan.md](./plan.md)
- Vitest workers pool: https://developers.cloudflare.com/workers/testing/vitest-integration/
- Hono testing: https://hono.dev/docs/guides/testing

## Overview

- Priority: P1 (gate before deploy)
- Status: Pending
- Build the test matrix across unit (schema mapper, ORM), middleware (auth), and integration (routes with mocked Bitrix + KV via workers pool).

## Key Insights

- `@cloudflare/vitest-pool-workers` gives real KV namespaces per test (isolated). No need to mock KV.
- Mock Bitrix by overriding `globalThis.fetch` per test (or a helper `mockFetch(handler)`).
- Hono `app.request(path, init)` returns a `Response` — perfect for end-to-end test without booting `wrangler dev`.
- Read-before-write must be asserted explicitly: write field A, then write field B, then read — both must persist.

## Requirements

**Functional**
- Unit: `schema-mapper.test.ts`, `orm.test.ts`, `auth.test.ts`.
- Integration: `lists-routes.test.ts`, `crm-routes.test.ts`.
- All tests pass under `npm run test`.
- ≥80% line coverage on `src/services/*` and `src/middleware/*`.

**Non-functional**
- Each test file <200 LOC.
- Tests run in <30s wall clock (mock fetch — no real Bitrix calls).
- Zero flaky tests across 5 consecutive runs.

## Architecture

```
vitest run
   ├── pool: @cloudflare/vitest-pool-workers
   │     └── per-test isolated KV (binding SCHEMA_KV)
   │
   ├── helper: mockFetch(handler)
   │     └── monkey-patches globalThis.fetch
   │
   └── helper: testEnv() → { SCHEMA_KV, BITRIX_WEBHOOK_URL, WORKER_API_KEY }
```

## Related Code Files

**Create**
- `src/tests/_helpers.ts` (mockFetch, testEnv, fixtures)
- `src/tests/schema-mapper.test.ts`
- `src/tests/orm.test.ts`
- `src/tests/auth.test.ts`
- `src/tests/lists-routes.test.ts`
- `src/tests/crm-routes.test.ts`

**Modify**
- `vitest.config.ts` — add `coverage` config (`provider: "istanbul"`, `include: ["src/**"]`, `thresholds: { lines: 80, functions: 80 }`).
- `package.json` — add `test:coverage` script `vitest run --coverage`.

**Delete** — none

## Implementation Steps

1. **`_helpers.ts`**:
   - `mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>)`: assigns `globalThis.fetch`; returns restore fn.
   - `bitrixOk(result: any) → Response` (200 + `{ result }`).
   - `bitrix503() → Response` (503 + `{ error: "QUERY_LIMIT_EXCEEDED" }`).
   - `fixtureSchema(): BitrixSchema` (toBitrix: `{ phone: "PROPERTY_123", note: "PROPERTY_124", counter: "PROPERTY_125" }`).
   - `fixtureFieldsResponse()` (raw Bitrix `lists.field.get` response).
2. **`schema-mapper.test.ts`**:
   - `slugify` cases: spaces, punctuation, mixed case.
   - `transformToBitrix` maps clean → PROPERTY_VALUES; drops unmapped.
   - `transformToClean` unwraps `n0.value`; preserves `id`.
   - `buildListSchema` flow:
     - First call: fetch invoked once + KV written.
     - Second call: fetch NOT invoked (RAM cache hit).
     - After RAM clear (re-import or new isolate): fetch NOT invoked (KV hit), KV.get called.
     - `invalidateSchema` purges both layers.
3. **`orm.test.ts`**:
   - `paginate`: mock 75 items; page 1 returns 50, page 2 returns 25, totalPages=2.
   - `updateOrCreate` create path: filter returns empty → add called with generated `ELEMENT_CODE`.
   - `updateOrCreate` update path: filter returns 1 → assert update payload includes BOTH new field AND existing field (read-before-write).
   - `math`: existing counter "5", `+3` → update called with "8" AND preserves other fields.
   - `math` rejects NaN previous (mock returns `"abc"`).
   - `softDelete`: with `is_deleted` mapped → sets "Y"; without → sets `ACTIVE: "N"`.
   - `upsertCrmEntity` PHONE create: write payload PHONE field is `[{ VALUE, VALUE_TYPE: "WORK" }]`.
   - `upsertCrmEntity` UF_CRM_MST update: filter hit returns id → update called with that id.
   - `createDeal` passes `entityTypeId: 2` and forwards `CONTACT_ID`/`COMPANY_ID`.
4. **`auth.test.ts`**:
   - `app.request("/api/lists/1")` → 401, `error: "unauthorized"`.
   - With `Authorization: Bearer wrong` → 401.
   - With `Authorization: Bearer ${WORKER_API_KEY}` → passes auth (returns whatever route handler returns).
   - `GET /health` → 200 without auth.
5. **`lists-routes.test.ts`**:
   - One mocked Bitrix fetch per scenario.
   - `GET /api/lists/123?page=1&filter[phone]=+84` → 200 with envelope.
   - `PATCH /api/lists/123/upsert/phone` → returns `action`.
   - `PATCH /api/lists/123/777/math/counter` body `{ amount: 1 }` → 200 with `previous`/`current`.
   - Invalid amount → 400.
   - Missing token → 401.
6. **`crm-routes.test.ts`**:
   - `PATCH /api/crm/contact/upsert/PHONE` body `{ phone: "+84..." }` create + update flows.
   - `PATCH /api/crm/company/upsert/UF_CRM_MST` create + update.
   - `POST /api/crm/deal` body `{ TITLE, CONTACT_ID, COMPANY_ID }` → 200 with deal id.
   - Bitrix 503 persistent → 502/503 envelope after retries.

## Todo List

- [x] `_helpers.ts` with `mockFetch`, `bitrixOk`, `bitrix503`, fixtures
- [x] `schema-mapper.test.ts` covers slugify + transforms + cache layers
- [x] `orm.test.ts` covers all 6 verbs incl. read-before-write assertion
- [x] `auth.test.ts` covers 4 auth scenarios + health
- [x] `lists-routes.test.ts` covers all 5 endpoints
- [x] `crm-routes.test.ts` covers all 3 endpoints
- [x] `vitest.config.ts` updated with coverage thresholds
- [x] `npm run test` exits 0
- [x] `npm run test:coverage` ≥80% lines on src/services + src/middleware
- [x] All test files <200 LOC

## Success Criteria

- 100% of route endpoints have at least one passing integration test.
- Read-before-write assertion: explicit test asserts that `updateOrCreate({ phone })` after seeding `{ phone, note }` does NOT clear `note`.
- Auth coverage: 401 on missing/wrong token; 200 on valid token.
- Persistent 503 from Bitrix: route returns 502/503 envelope after exactly 3 attempts.
- Coverage ≥80% on services + middleware.
- 5 consecutive `npm run test` runs all green.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Backoff sleeps slow tests | High | Med | Inject `RATE_LIMIT_DELAY_MS=0` in tests via env override or module mock |
| KV state leaks between tests | Low | Med | workers pool isolates per test; assert with `beforeEach` cleanup as belt+suspenders |
| `globalThis.fetch` mock leaks across tests | Med | Med | `afterEach` restores via returned fn |
| Coverage thresholds force trivial tests | Low | Low | Set 80% not 100%; accept lower on routes (they delegate) |

## Security Considerations

- Test fixtures use placeholder `WORKER_API_KEY` — never reuse a real prod key.
- No real Bitrix webhook URLs in fixtures (use `https://example.test/rest`).

## Next Steps

- After green: deploy to `client_a` env via `wrangler deploy --env client_a`.
- Manual smoke test: `curl -H "Authorization: Bearer ..." https://.../health`.
- Set up CI to run `npm run test:coverage` on PR.

## Rollback

Tests are non-prod artifacts; deletion has no production impact. Coverage threshold can be temporarily lowered if a refactor invalidates tests, with follow-up issue tracked.

## Unresolved Questions

- None at planning stage — verify `crm.item.list` filter on `PHONE` actually works with `entityTypeId=3` during integration; if Bitrix returns inconsistent shape, may need to filter by raw multifield path. Decision deferred to test execution.
