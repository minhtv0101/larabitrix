---
phase: 4
title: "ORM Engine"
status: completed
effort: 3h
---

# Phase 4: ORM Engine

## Context Links

- Plan: [plan.md](./plan.md)
- Bitrix `lists.element.*`: https://apidocs.bitrix24.com/api-reference/lists/elements/index.html
- Bitrix `crm.item.*`: https://apidocs.bitrix24.com/api-reference/crm/universal/index.html
- entityTypeId map: contact=3, company=4, deal=2

## Overview

- Priority: P1 (blocks Phase 5)
- Status: Pending
- Compose `bitrix24-client` + `schema-mapper` into the verbs the routes consume: `paginate`, `updateOrCreate`, `math`, `softDelete` for Lists; `upsertCrmEntity`, `createDeal` for CRM.

## Key Insights

- Bitrix Lists `update` REPLACES the row — any field omitted from `PROPERTY_VALUES` is **cleared**. Always read-before-write and merge.
- Lists pagination is fixed 50 per page; offset = `(page - 1) * 50`. Total count is in response `total`.
- `ELEMENT_CODE` must be unique on add — generate `ts-${Date.now()}-${randomHex}`.
- `crm.item.list` filter syntax: `filter[PHONE]=...` (note: PHONE is multifield; filter via `PHONE` works in `crm.item.list` because the universal API normalizes).
- Phone multifield write shape: `PHONE: [{ VALUE: "+84...", VALUE_TYPE: "WORK" }]`.
- `crm.contact.list` is deprecated — use `crm.item.list` with `entityTypeId=3`.
- For the Contact upsert by PHONE, query with `filter: { PHONE: phone }, select: ["*", "PHONE"]`.

## Requirements

**Functional**
- `paginate(env, iblockId, filter, page = 1)`: returns `{ items: clean[], page, total, totalPages }`.
- `updateOrCreate(env, iblockId, uniqueField, payload)`:
  - Find existing via filter on `PROPERTY_<mapped>`.
  - If found: read full row → merge `existing.cleanFields ∪ payload` → `lists.element.update` with full PROPERTY_VALUES.
  - If not: `lists.element.add` with `ELEMENT_CODE: \`ts-${Date.now()}-${rand}\`` + `NAME: payload.name ?? <unique value>` + transformed payload.
  - Return `{ id, action: "created" | "updated", item: clean }`.
- `math(env, iblockId, itemId, fieldName, amount)`:
  - Read row, parse `Number(current)` (default 0), add `amount` (can be negative).
  - Update row with merged PROPERTY_VALUES (read-before-write rule applies).
  - Return `{ id, field, previous, current }`.
- `hardDelete(env, iblockId, itemId)`:
  - Call `lists.element.delete` with `IBLOCK_TYPE_ID: "lists"`, `IBLOCK_ID: iblockId`, `ELEMENT_ID: itemId`.
  - Return `{ id: itemId, deleted: true }`.
  - <!-- Updated: Validation Session 1 — soft delete replaced with hard delete per user decision -->
- `upsertCrmEntity(env, entityTypeId, uniqueField, uniqueValue, payload)`:
  - `crm.item.list` filter `{ [uniqueField]: uniqueValue }`, select `["*"]`.
  - If found: `crm.item.update` with `id` + `fields: payload`.
  - If not: `crm.item.add` with `fields: { [uniqueField]: uniqueValue, ...payload }`.
  - Phone normalization: if `uniqueField === "PHONE"` wrap as `[{ VALUE: uniqueValue, VALUE_TYPE: "WORK" }]` only when writing (not in filter).
  - Return `{ id, action, item }`.
- `createDeal(env, fields)`:
  - `crm.item.add` with `entityTypeId: 2`, `fields`.
  - Pass through `CONTACT_ID`, `COMPANY_ID` if provided.
  - Return `{ id, item }`.

**Non-functional**
- Each verb is its own exported function; no class.
- File <200 LOC (split if needed: `orm-lists.ts`, `orm-crm.ts`).

## Architecture

```
Route handler (Phase 5)
        │
        ▼
   orm verb (this phase)
        │
        ▼ (1) buildListSchema(env, iblockId)   [Phase 3]
        │
        ▼ (2) callApi(env, "lists.element.get", filter)   [Phase 2]
        │
        ▼ (3) merge existing + payload   (read-before-write)
        │
        ▼ (4) callApi(env, "lists.element.update" | "add", merged)
        │
        ▼ (5) transformToClean(result, schema)
        │
        ▼ return clean object
```

## Related Code Files

**Create**
- `src/services/orm.ts` (split into `orm-lists.ts` + `orm-crm.ts` if >200 LOC)

**Read**
- `src/types.ts`
- `src/services/bitrix24-client.ts`
- `src/services/schema-mapper.ts`

**Modify** — none
**Delete** — none

## Implementation Steps

1. **`paginate`**: build filter by translating clean keys via `schema.toBitrix`. Call `lists.element.get` with `IBLOCK_TYPE_ID: "lists"`, `IBLOCK_ID`, `FILTER`, `start: (page - 1) * 50`. Map results via `transformToClean`. Compute `totalPages = Math.ceil(total / 50)`.
2. **`updateOrCreate`**:
   - Resolve `propKey = schema.toBitrix[uniqueField]`; throw `BitrixApiError("unknown_field", uniqueField)` if missing.
   - `existing = await callApi("lists.element.get", { FILTER: { [propKey]: payload[uniqueField] } })` → first hit.
   - If exists: build `merged = { ...transformToClean(existing, schema), ...payload }`. Call `lists.element.update` with `ELEMENT_ID: existing.ID` + `FIELDS: { ...transformToBitrix(merged, schema), NAME: merged.name ?? existing.NAME }`. Return `{ action: "updated", id: existing.ID, item: merged }`.
   - Else: `ELEMENT_CODE = \`ts-${Date.now()}-${crypto.randomUUID().slice(0,8)}\``. Call `lists.element.add` with `ELEMENT_CODE`, `NAME: payload.name ?? payload[uniqueField]`, `FIELDS: { ...transformToBitrix(payload, schema) }`. Return `{ action: "created", id: <new>, item: payload }`.
3. **`math`**:
   - Read `existing` via `lists.element.get` filtered by `ID: itemId`.
   - `existingClean = transformToClean(existing, schema)`.
   - `previous = Number(existingClean[fieldName] ?? 0)`. Throw if `Number.isNaN(previous)`.
   - `current = previous + amount`.
   - Merge as in `updateOrCreate`; call `lists.element.update`.
   - Return `{ id: itemId, field: fieldName, previous, current }`.
4. **`softDelete`**:
   - If `schema.toBitrix.is_deleted` exists → `updateOrCreate`-style merge with `is_deleted = "Y"`.
   - Else → `lists.element.update` with `ELEMENT_ID: itemId, FIELDS: { ACTIVE: "N" }` (no merge needed; ACTIVE is top-level).
   - Return `{ id: itemId, deleted: true }`.
5. **`upsertCrmEntity(env, entityTypeId, uniqueField, uniqueValue, payload)`**:
   - `found = await callApi("crm.item.list", { entityTypeId, filter: { [uniqueField]: uniqueValue }, select: ["*"] })`.
   - `existing = found.items?.[0]`.
   - Normalize PHONE in payload if needed (helper `normalizePhone(value)`).
   - If existing: `await callApi("crm.item.update", { entityTypeId, id: existing.id, fields: payload })`. Return `{ action: "updated", id: existing.id }`.
   - Else: `merged = { [uniqueField]: uniqueField === "PHONE" ? normalizePhone(uniqueValue) : uniqueValue, ...payload }`. `await callApi("crm.item.add", { entityTypeId, fields: merged })`. Return `{ action: "created", id: result.item.id }`.
6. **`createDeal(env, fields)`**: `await callApi("crm.item.add", { entityTypeId: 2, fields })`. Return `{ id: result.item.id, item: result.item }`.
7. **Helper** `normalizePhone(value)`: returns `[{ VALUE: value, VALUE_TYPE: "WORK" }]`.

## Todo List

- [x] `paginate` returns `{ items, page, total, totalPages }`
- [x] `updateOrCreate` performs read-before-write merge
- [x] `updateOrCreate` generates unique `ELEMENT_CODE` on create
- [x] `math` rejects NaN previous values
- [x] `hardDelete` calls `lists.element.delete`, returns `{ id, deleted: true }`
- [x] `upsertCrmEntity` uses `crm.item.list` (not deprecated `crm.contact.list`)
- [x] PHONE normalized as multifield array on write
- [x] `createDeal` passes through CONTACT_ID/COMPANY_ID
- [x] All verbs throw `BitrixApiError` with stable codes
- [x] File <200 LOC (split if needed)

## Success Criteria

- Round-trip: create item → fetch by unique field → matches input.
- Read-before-write: updating only one field does NOT clear other fields (verified in test).
- `math(+5)` then `math(-3)` on a fresh field returns `current=2`.
- `hardDelete` returns `{ id, deleted: true }` and item is gone from Bitrix permanently.
- Upsert contact by phone twice → second call returns `action: "updated"` with same id.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Forgetting read-before-write nukes data | High | Critical | Centralize merge in `updateOrCreate` + `math`; test asserts unrelated fields preserved |
| Race: concurrent updates clobber each other | Med | High | Document as known limit; rate limiter caps to 2 req/s; future: ETag-style guard |
| Phone format mismatch causes duplicate contacts | Med | High | Normalize phone before filter+write; test with `+84`/`084` variants |
| `ELEMENT_CODE` collision under burst | Low | Med | UUID suffix in code generator |
| `crm.item.list` filter shape changes by entity | Low | Med | Wrap each entityTypeId in its own caller helper if drift observed |

## Security Considerations

- ORM trusts route layer for auth; never accepts raw filter strings (only object-shape filters).
- No SQL — Bitrix REST is typed JSON; no injection vector beyond what Bitrix itself accepts.
- Reject filters on unmapped fields to avoid leaking property IDs.

## Next Steps

- Phase 5 wires HTTP routes onto these verbs.
- Phase 6 adds unit + integration tests.

## Rollback

Delete `orm.ts` (and any split files). No external state mutation outside Bitrix; production rollback requires no DB migration.
