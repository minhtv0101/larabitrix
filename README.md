# Larabitrix

Cloudflare Worker middleware that wraps Bitrix24 REST API into a clean RESTful interface. Acts as an API Gateway + ORM layer between automation platforms (n8n, Wix, custom apps) and Bitrix24.

## Features

- **Dynamic Schema Mapping** — auto-learns Bitrix24 field IDs and exposes them as human-readable slugs (`PROPERTY_112` → `so_buoi_hoc`)
- **ORM operations** — `upsert`, `math` (increment/decrement), `softDelete`, `paginate`
- **Read-before-write** — prevents accidental field erasure on `lists.element.update`
- **Rate limiter** — enforces ≤ 2 req/s via 550ms sleep + exponential backoff retry (max 3)
- **CRM entities** — unified ORM for Contact, Company, Deal with auto-bind support
- **Schema cache** — persists to Cloudflare KV; avoids redundant `lists.field.get` calls
- **Multi-tenant** — one codebase, one deploy per client via Wrangler environments

## Architecture

```
n8n / Wix / App
       │
       ▼ Bearer Token
  ┌─────────────────────────────┐
  │       Larabitrix Worker      │
  │  Auth → Router → Schema      │
  │  Mapper → ORM → Rate Limiter │
  └───────────────┬─────────────┘
        KV Cache  │
                  ▼
           Bitrix24 REST API
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check (no auth) |
| `GET` | `/api/lists/:id?page=1` | List items with pagination |
| `POST` | `/api/lists/:id` | Create item |
| `PATCH` | `/api/lists/:id/upsert/:field` | Upsert item by unique field |
| `PATCH` | `/api/lists/:id/:itemId/math/:field` | Increment/decrement a numeric field |
| `PATCH` | `/api/lists/:id/:itemId/soft-delete` | Soft delete (marks `is_deleted = Y`) |
| `PATCH` | `/api/crm/contact/upsert/PHONE` | Upsert CRM Contact by phone |
| `PATCH` | `/api/crm/company/upsert/UF_CRM_MST` | Upsert CRM Company by tax code |
| `POST` | `/api/crm/deal` | Create Deal (with optional contact/company binding) |
| `DELETE` | `/api/cache/:id` | Invalidate schema cache for a List |

All `/api/*` routes require `Authorization: Bearer <WORKER_API_KEY>`.

## Project Structure

```
src/
├── index.ts                  # Entry point, route mounts, global error handler
├── types.ts                  # Env, schema, and response type definitions
├── middleware/
│   ├── auth.ts               # Bearer token validation
│   └── rate-limiter.ts       # 550ms sleep + retry logic
├── routes/
│   ├── lists.ts              # Lists CRUD + cache routes
│   └── crm.ts                # CRM entity routes
├── services/
│   ├── bitrix24-client.ts    # Fetch wrapper with retry/error handling
│   ├── schema-mapper.ts      # Field slug ↔ PROPERTY_ID mapping + KV cache
│   ├── orm-lists.ts          # Lists ORM (upsert, math, softDelete, paginate)
│   └── orm-crm.ts            # CRM ORM (upsert, bind entities)
└── tests/
    ├── _helpers.ts
    ├── auth.test.ts
    ├── lists-routes.test.ts
    ├── crm-routes.test.ts
    ├── orm.test.ts
    └── schema-mapper.test.ts
```

## Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) — `npm install -g wrangler`
- Cloudflare account with Workers and KV enabled
- Bitrix24 account with REST API webhook URL

## Local Development

```bash
# Install dependencies
npm install

# Copy env example
cp .env.example .env.local
# Fill in BITRIX_WEBHOOK_URL and WORKER_API_KEY

# Start local dev server (http://localhost:8787)
npm run dev

# Type check
npm run typecheck

# Run tests
npm test
```

## Deploy

### First-time setup

```bash
# 1. Authenticate Wrangler with your Cloudflare account
wrangler login

# 2. Create KV namespace (run once per client)
wrangler kv namespace create SCHEMA_KV
# Copy the returned `id` into wrangler.jsonc under the correct env block

# 3. Deploy
npm run deploy
# or deploy to a specific client environment:
wrangler deploy --env client_a
```

### Provision secrets (per client)

```bash
# Set via Wrangler — never commit these values
wrangler secret put BITRIX_WEBHOOK_URL --env client_a
wrangler secret put WORKER_API_KEY --env client_a
```

### Multi-client strategy

Each client gets its own named Worker and KV namespace, all from this single repo:

```bash
# Client A
wrangler deploy --env client_a
wrangler secret put BITRIX_WEBHOOK_URL --env client_a
wrangler secret put WORKER_API_KEY --env client_a

# Client B
wrangler deploy --env client_b
wrangler secret put BITRIX_WEBHOOK_URL --env client_b
wrangler secret put WORKER_API_KEY --env client_b
```

Add new clients by adding a new block under `"env"` in `wrangler.jsonc` with a fresh KV namespace ID.

### View real-time logs

```bash
wrangler tail --env client_a
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BITRIX_WEBHOOK_URL` | Bitrix24 incoming webhook URL (e.g. `https://your-domain.bitrix24.com/rest/1/xxxx/`) |
| `WORKER_API_KEY` | Secret key used by callers in `Authorization: Bearer` header |

Both are provisioned as Cloudflare secrets via `wrangler secret put` — never stored in `wrangler.jsonc`.

## Example Request

```bash
# Upsert a CRM contact by phone
curl -X PATCH https://larabitrix-client-a.your-subdomain.workers.dev/api/crm/contact/upsert/PHONE \
  -H "Authorization: Bearer YOUR_WORKER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"PHONE": [{"VALUE": "0901234567", "VALUE_TYPE": "WORK"}], "NAME": "Nguyen Van A"}'

# Upsert a Lists item by unique slug field
curl -X PATCH https://larabitrix-client-a.your-subdomain.workers.dev/api/lists/42/upsert/ma_hoc_vien \
  -H "Authorization: Bearer YOUR_WORKER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ma_hoc_vien": "HV001", "so_buoi_hoc": 10}'
```

## License

MIT
