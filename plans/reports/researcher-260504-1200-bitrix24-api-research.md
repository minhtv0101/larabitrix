# Bitrix24 REST API Research Report

**Date**: 2026-05-04  
**Focus**: Middleware wrapper design for Lists API, CRM API, rate limiting, and authentication

---

## 1. Universal Lists API

### lists.field.get Response & Field Types

**Response Structure**:
- Returns object with field metadata: FIELD_ID, TYPE, PROPERTY_TYPE, NAME, IS_REQUIRED, MULTIPLE, CODE, DISPLAY_VALUES_FORM
- Use `lists.field.type.get` to enumerate all type codes

**Field Types** (via lists.field.type.get):
- System: SORT, ACTIVE_FROM, ACTIVE_TO, PREVIEW_PICTURE, PREVIEW_TEXT, DETAIL_PICTURE, DETAIL_TEXT, CREATED_BY, TIMESTAMP_X, MODIFIED_BY
- Custom: S (string), N (number), L (list), F (file), G (section binding), E (element binding), S:Date, S:DateTime, S:HTML, E:EList, N:Sequence, S:ECrm, S:Money, S:DiskFile, S:employee
- **Gotcha**: Type "L" returns DISPLAY_VALUES_FORM (key=id, value=label) for dropdown fields

### lists.element.get

**Pagination**:
- Fixed page size: **50 records per batch**
- Formula: `start = (N - 1) * 50` (N = page number)
- Example: start=0 → page 1, start=50 → page 2, start=100 → page 3
- **Gotcha**: START is 0-indexed; non-50-multiple values may yield unexpected results

**Response Structure**:
- `result`: array of elements (empty if no matches)
- `total`: total element count
- `time`: execution metrics (start, finish, duration, date_start, date_finish)

**Filter Format**:
- Object: `{"field_1": "value_1", "field_2": "value_2"}`
- Operators: `@` (IN), `!@` (NOT IN), `>=`, `>`, `<=`, `<`, `=`, `!=`, `%` (LIKE), `=%`/`!=%` (explicit wildcard)
- Filterable: NAME, IBLOCK_SECTION_ID, CREATED_BY, DATE_CREATE, PROPERTY_PropertyId (custom fields)

### lists.element.add

**Required Fields**:
- IBLOCK_TYPE_ID (e.g., "lists")
- IBLOCK_ID or IBLOCK_CODE (at least one)
- ELEMENT_CODE (marked required; API will reject if omitted)
- FIELDS.NAME (required; no auto-generation)

**Behavior**:
- Response: element ID and metadata
- **Gotcha**: ELEMENT_CODE must be unique within list; non-unique values fail silently or error 400

### lists.element.update

**Critical Gotcha**: **Omitted fields are cleared, not preserved**
- API "completely overwrites the element"
- Must provide all fields to preserve, or they will be deleted
- Design middleware to fetch full element before partial updates
- Alternatively, accept only full-record updates in wrapper API

### lists.element.delete

**Type**: Hard delete (files removed from Drive if not used elsewhere)
**Response**: HTTP 200 with `result: true` on success
**Error Codes**: 400 (invalid params), 401 (auth), 403 (permissions), 404 (not found), 500 (internal), 503 (throttled)

---

## 2. CRM API

### crm.contact.add

**Required Fields**: None explicitly; all have defaults:
- HONORIFIC → first available salutation type
- TYPE_ID → first available contact type
- SOURCE_ID → first available source type
- ASSIGNED_BY_ID → calling user

**Phone Field Format**:
```json
"PHONE": [
  {"VALUE": "+1333333555", "VALUE_TYPE": "WORK"},
  {"VALUE": "+15599888666", "VALUE_TYPE": "HOME"}
]
```
- Multifield array; supports multiple phones per contact
- VALUE_TYPE examples: WORK, HOME, MOBILE
- **Gotcha**: Extension format: "22-33-44;55" (55 = extension)
- Similar structure for EMAIL, WEB, IM, LINK fields

### crm.contact.list (DEPRECATED)

**Status**: Development halted; use `crm.item.list` (entityTypeId=3) instead
- Pagination: 50 records/page, start = (N-1)*50
- Filters: Same operators as lists.element.get
- **Gotcha**: Old method; new integrations should use crm.item.list

### crm.deal.add with Relationships

**Binding Parameters**:
- COMPANY_ID: single company (retrieve via crm.item.list entityTypeId=4)
- CONTACT_IDS: array of contact IDs (retrieve via crm.item.list entityTypeId=3)
- Both optional; include in FIELDS object

**Example**:
```json
{"COMPANY_ID": 9, "CONTACT_IDS": [84, 83]}
```

---

## 3. Rate Limiting & Throttling

**Request Intensity (Leaky Bucket Algorithm)**:

| Plan | Counter Decrease Rate | Blocking Threshold |
|------|----------------------|-------------------|
| Enterprise | 5 req/sec | 250 |
| Other plans | 2 req/sec | 50 |

**Key Rule**: If requests ≤ Y/sec (plan-dependent), no QUERY_LIMIT_EXCEEDED error.

**Error Codes**:
- 503 + `QUERY_LIMIT_EXCEEDED` → intensity exceeded
- `operating_reset_at` field in response indicates when capacity refreshes

**Resource Consumption**:
- Methods blocked if total execution time >480 seconds in 10-minute window
- Monitor `operating` time metric in responses

**Retry Strategy Recommendations**:
1. Use batch requests (50 per single call)
2. Leverage list methods returning 50 records
3. Implement exponential backoff on 503
4. Queue requests to stay ≤2 req/sec (non-Enterprise)

**Webhook Gotcha**: Delivery can delay 5-10 minutes during peak usage; unsuitable for time-critical integrations.

---

## 4. Authentication & Webhook Security

- Use webhook URL format: `https://your-domain.bitrix24.com/rest/{userId}/{webhookCode}/`
- Webhook payload signed; validate signatures on receipt
- OAuth2 also supported for production integrations
- **No explicit secret-based rate limiting per webhook mentioned**; all rate limits are account-wide

---

## Middleware Wrapper Design Implications

### Critical Implementation Decisions

1. **Element Updates**: Middleware must implement full-record semantics or fetch-then-merge pattern
2. **Pagination**: Hardcode page size = 50; calculate start consistently
3. **Filters**: Map wrapper filter syntax to Bitrix24 operator prefixes
4. **Phone Fields**: Parse/serialize multifield arrays with VALUE/VALUE_TYPE
5. **Delete Operations**: Warn users this is irreversible
6. **CRM Deprecation**: Migrate to crm.item.list; map entityTypeId (3=contact, 4=company)
7. **Throttling**: Implement client-side queue to enforce ≤2 req/sec (or 5 for Enterprise)
8. **Webhook Delays**: Document 5-10 min delivery window; don't rely for real-time sync

---

## Unresolved Questions

1. Does ELEMENT_CODE auto-generate if omitted, or return error 400? (Documentation marks required but doesn't detail failure mode)
2. What exact error message for non-unique ELEMENT_CODE? (Soft failure vs. hard error unclear)
3. Webhook signature algorithm and validation details? (Not documented in fetched pages)
4. Can crm.item.list accept same filters as crm.contact.list? (Backward compatibility level unknown)
5. Does lists.element.delete return file URLs for audit trail, or just true? (Metadata in response unclear)

---

## Sources

- [lists.field.get](https://apidocs.bitrix24.com/api-reference/lists/fields/lists-field-get.html)
- [lists.field.type.get](https://apidocs.bitrix24.com/api-reference/lists/fields/lists-field-type-get.html)
- [lists.element.get](https://apidocs.bitrix24.com/api-reference/lists/elements/lists-element-get.html)
- [lists.element.add](https://training.bitrix24.com/rest_help/lists/elements/lists_element_add.php)
- [lists.element.update](https://apidocs.bitrix24.com/api-reference/lists/elements/lists-element-update.html)
- [lists.element.delete](https://apidocs.bitrix24.com/api-reference/lists/elements/lists-element-delete.html)
- [crm.contact.add](https://apidocs.bitrix24.com/api-reference/crm/contacts/crm-contact-add.html)
- [crm.contact.list](https://apidocs.bitrix24.com/api-reference/crm/contacts/crm-contact-list.html)
- [crm.deal.add](https://apidocs.bitrix24.com/api-reference/crm/deals/crm-deal-add.html)
- [REST API Limits](https://apidocs.bitrix24.com/limits.html)
- [Data Types & Formats](https://apidocs.bitrix24.com/api-reference/data-types.html)
