---
phase: 3
title: "Dynamic Schema Mapper"
status: completed
effort: 2h
---

# Phase 3: Dynamic Schema Mapper

## Context Links

- Plan: [plan.md](./plan.md)
- Bitrix Lists fields: https://apidocs.bitrix24.com/api-reference/lists/lists-field-get.html
- KV cacheTtl semantics: https://developers.cloudflare.com/kv/api/read-key-value-pairs/#cachettl-parameter

## Overview

- Priority: P1 (blocks Phase 4)
- Status: Pending
- Two-layer cache (RAM + KV) of Bitrix Lists field metadata. Translates clean payloads (`{ name: "X" }`) ⇄ Bitrix payloads (`{ PROPERTY_123: "X" }`).

## Key Insights

- `lists.field.get` returns object keyed by `PROPERTY_xxx`; each value has `NAME`, `CODE`, `TYPE`, etc.
- Prefer `CODE` when present (developer-set, stable); fall back to slugified `NAME`.
- Bitrix Lists READ responses nest values: `PROPERTY_VALUES.PROPERTY_123 = { n0: { value: "X", VALUE: "X" } }` — must extract `.n0.value` (or first key under it).
- Bitrix Lists WRITE format: `PROPERTY_VALUES: { PROPERTY_123: "X" }` (flat).
- KV TTL 86400s (24h); `cacheTtl: 300s` to dampen edge revalidation.
- RAM cache (module-level `Map`) is per-isolate — drops on isolate eviction; that's OK because KV is the source of truth.

## Requirements

**Functional**
- `buildListSchema(env, iblockId)`: returns `BitrixSchema`. Order of lookup: RAM → KV → Bitrix API.
- `transformToBitrix(clean, schema)`: flatten clean keys into `PROPERTY_VALUES` shape for write.
- `transformToClean(bitrixItem, schema)`: flat clean object including `id` (from `ID`), with all PROPERTY_xxx values unwrapped.
- `slugify(text)`: `text.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")`.
- `invalidateSchema(env, iblockId)`: deletes RAM + KV entry (used by future ops or tests).

**Non-functional**
- Pure functions for transforms (no env dependency).
- File <200 LOC.

## Architecture

```
buildListSchema(env, iblockId)
   │
   ▼ (1) RAM check: schemaCache[iblockId]
   │     hit → return
   │
   ▼ (2) KV check: env.SCHEMA_KV.get(`schema:${iblockId}`, { cacheTtl: 300 })
   │     hit → hydrate RAM, return
   │
   ▼ (3) callApi(env, "lists.field.get", { IBLOCK_TYPE_ID: "lists", IBLOCK_ID: iblockId })
         build toBitrix/toClean
         env.SCHEMA_KV.put(key, JSON.stringify(schema), { expirationTtl: 86400 })
         schemaCache[iblockId] = schema
         return
```

```
transformToBitrix({ phone: "...", note: "..." }, schema)
  → { PROPERTY_VALUES: { PROPERTY_123: "...", PROPERTY_456: "..." } }

transformToClean({ ID: "7", PROPERTY_VALUES: { PROPERTY_123: { n0: { value: "..." } } } }, schema)
  → { id: "7", phone: "..." }
```

## Related Code Files

**Create**
- `src/services/schema-mapper.ts`

**Read**
- `src/types.ts` (BitrixSchema)
- `src/services/bitrix24-client.ts` (callApi)

**Modify** — none
**Delete** — none

## Implementation Steps

1. Module-level `const schemaCache = new Map<string, BitrixSchema>()`.
2. `slugify(text)` per spec above.
3. `buildListSchema(env, iblockId)`:
   - RAM check `schemaCache.get(iblockId)` → return if found.
   - KV check `await env.SCHEMA_KV.get(\`schema:${iblockId}\`, { type: "json", cacheTtl: 300 })` → if found cast to `BitrixSchema`, set RAM, return.
   - Call `callApi(env, "lists.field.get", { IBLOCK_TYPE_ID: "lists", IBLOCK_ID: iblockId })`.
   - Iterate result entries `[propertyKey, fieldDef]`:
     - `cleanKey = fieldDef.CODE ? fieldDef.CODE.toLowerCase() : slugify(fieldDef.NAME)`
     - `toBitrix[cleanKey] = propertyKey` (e.g. `phone → PROPERTY_123`)
     - `toClean[propertyKey] = cleanKey`
   - Build `schema = { iblockId, toBitrix, toClean, fetchedAt: Date.now() }`.
   - `await env.SCHEMA_KV.put(\`schema:${iblockId}\`, JSON.stringify(schema), { expirationTtl: 86400 })`.
   - `schemaCache.set(iblockId, schema)`.
   - Return schema.
4. `transformToBitrix(clean, schema)`:
   - `PROPERTY_VALUES = {}`
   - For each `[k, v]` in clean: if `schema.toBitrix[k]` exists, set `PROPERTY_VALUES[schema.toBitrix[k]] = v`.
   - Return `{ PROPERTY_VALUES }` (caller merges with `NAME`, `ELEMENT_CODE`, etc).
5. `transformToClean(item, schema)`:
   - `out: Record<string, unknown> = { id: item.ID }`
   - If `item.NAME`, `out.name = item.NAME`.
   - For each `[propKey, raw]` in `item.PROPERTY_VALUES ?? {}`:
     - Resolve clean key via `schema.toClean[propKey]` (skip if unmapped).
     - Unwrap value: if raw is object with single nested key (e.g. `n0`), take `nested.value ?? nested.VALUE`; else use raw directly.
     - `out[cleanKey] = unwrapped`.
   - Return `out`.
6. `invalidateSchema(env, iblockId)`: delete RAM + `env.SCHEMA_KV.delete(...)`.

## Todo List

- [x] `slugify` matches spec
- [x] RAM → KV → API lookup order verified
- [x] KV write uses `expirationTtl: 86400`
- [x] KV read uses `cacheTtl: 300`
- [x] `transformToBitrix` produces `{ PROPERTY_VALUES: {...} }`
- [x] `transformToClean` unwraps `n0.value` shape
- [x] `id` always present in clean output
- [x] Unmapped clean keys silently dropped (documented)
- [x] File <200 LOC

## Success Criteria

- Cold call hits Bitrix once, then KV, then RAM (verifiable in unit tests via call counts).
- Round-trip: `transformToClean(transformToBitrix(x))` reproduces x for mapped keys.
- `slugify("Phone Number!")` → `"phone_number"`.
- Schema persists 24h in KV.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `CODE` collisions across fields | Low | High | Detect duplicates during build; throw with both PROPERTY ids |
| Bitrix changes nested response shape | Low | High | Defensive unwrap: try `.n0.value`, then `.n0.VALUE`, then first child |
| RAM cache stale across deploys | Med | Low | RAM resets on isolate restart; KV TTL bounds staleness to 24h |
| Schema drift mid-request (field added) | Low | Med | Manual `invalidateSchema` exposed; document operator runbook |

## Security Considerations

- Schema cache key namespaced (`schema:${iblockId}`) to avoid collision with future KV uses.
- No PII stored in schema (field metadata only).

## Next Steps

- Phase 4 wraps schema mapper + client into ORM verbs.

## Rollback

Delete `schema-mapper.ts`. To purge cache in production: `wrangler kv key delete --binding SCHEMA_KV "schema:<iblockId>"` per affected list.
