---
phase: 1
title: "Project Setup & Config"
status: completed
effort: 1h
---

# Phase 1: Project Setup & Config

## Context Links

- Plan: [plan.md](./plan.md)
- CF Workers TS template: https://developers.cloudflare.com/workers/languages/typescript/
- Hono on Workers: https://hono.dev/docs/getting-started/cloudflare-workers
- Wrangler env config: https://developers.cloudflare.com/workers/wrangler/configuration/

## Overview

- Priority: P1 (blocker for all phases)
- Status: Pending
- Bootstrap repo: dependencies, TS config, Wrangler config (multi-env), Vitest, KV binding, shared types, env template.

## Key Insights

- Hono v4 + `@cloudflare/workers-types` is the standard stack; no Node runtime — must enable `nodejs_compat` flag for select polyfills.
- `wrangler.jsonc` (not `.toml`) is the supported format going forward and supports comments + env inheritance.
- KV namespace IDs differ per environment; the binding name (`SCHEMA_KV`) must stay constant.
- Vitest pool `@cloudflare/vitest-pool-workers` runs tests inside the actual Workers runtime (no `jsdom`).
- Secrets (`WORKER_API_KEY`, `BITRIX_WEBHOOK_URL`) MUST live in Wrangler secrets, never in `wrangler.jsonc`.

## Requirements

**Functional**
- Project compiles with `tsc --noEmit` and `wrangler deploy --dry-run`.
- `wrangler dev` boots a local Worker with KV binding stubbed.
- `vitest run` executes (zero tests OK at this phase).
- Multi-env scaffolding: `client_a`, `client_b` defined under `env.*` in `wrangler.jsonc`.

**Non-functional**
- Strict TS (`strict: true`, `noUncheckedIndexedAccess: true`).
- Node-style imports forbidden except where `nodejs_compat` justified.

## Architecture

```
Repo root
├── src/
│   ├── index.ts          (Phase 5)
│   ├── routes/           (Phase 5)
│   ├── middleware/       (Phase 2)
│   ├── services/         (Phases 2-4)
│   └── types.ts          (this phase)
├── wrangler.jsonc
├── tsconfig.json
├── vitest.config.ts
├── package.json
└── .env.example
```

Data flow: none yet — config-only.

## Related Code Files

**Create**
- `package.json`
- `tsconfig.json`
- `wrangler.jsonc`
- `vitest.config.ts`
- `src/types.ts`
- `.env.example`
- `.gitignore` (node_modules, .wrangler, .dev.vars, dist)

**Modify** — none
**Delete** — none

## Implementation Steps

1. `package.json`: scripts `dev` (`wrangler dev`), `deploy` (`wrangler deploy`), `test` (`vitest run`), `typecheck` (`tsc --noEmit`). Deps: `hono ^4`. DevDeps: `wrangler ^3`, `typescript ^5`, `vitest ^1`, `@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types`.
2. `tsconfig.json`: `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `lib: ["ES2022"]`, `types: ["@cloudflare/workers-types"]`, `strict: true`, `noUncheckedIndexedAccess: true`, `skipLibCheck: true`.
3. `wrangler.jsonc`: top-level `name: larabitrix`, `main: src/index.ts`, `compatibility_date: 2026-05-01`, `compatibility_flags: ["nodejs_compat"]`. Define `kv_namespaces: [{ binding: "SCHEMA_KV", id: "<placeholder>" }]`. Add `env.client_a` and `env.client_b` blocks each overriding `name` and `kv_namespaces.id`.
4. `vitest.config.ts`: import `defineWorkersConfig` from `@cloudflare/vitest-pool-workers/config`; point `wrangler.configPath` at `./wrangler.jsonc`.
5. `src/types.ts`:
   - `interface Env { SCHEMA_KV: KVNamespace; BITRIX_WEBHOOK_URL: string; WORKER_API_KEY: string }`
   - `interface BitrixSchema { iblockId: string; toBitrix: Record<string, string>; toClean: Record<string, string>; fetchedAt: number }`
   - `interface BitrixElement { ID: string; NAME?: string; PROPERTY_VALUES?: Record<string, unknown>; [k: string]: unknown }`
   - `type CrmEntity = "contact" | "company" | "deal"`
   - `interface ApiResponse<T = unknown> { success: boolean; data?: T; error?: string; code?: string }`
6. `.env.example`: `BITRIX_WEBHOOK_URL=`, `WORKER_API_KEY=` with comments pointing to `wrangler secret put`.
7. Run `npm install`, then `npm run typecheck` and `wrangler deploy --dry-run` to validate.

## Todo List

- [x] `package.json` with scripts + pinned versions
- [x] `tsconfig.json` strict
- [x] `wrangler.jsonc` with KV binding + env.client_a + env.client_b
- [x] `vitest.config.ts` using workers pool
- [x] `src/types.ts` with Env, BitrixSchema, BitrixElement, CrmEntity, ApiResponse
- [x] `.env.example` + `.gitignore`
- [x] `npm install` succeeds
- [x] `npm run typecheck` passes
- [x] `wrangler deploy --dry-run` passes

## Success Criteria

- `npm run typecheck` exits 0
- `vitest run` exits 0 (no tests yet)
- `wrangler deploy --dry-run --env client_a` exits 0
- KV namespace ID is referenced via binding name in code, never hardcoded

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Wrong `compatibility_date` breaks runtime API | Low | High | Pin to 2026-05-01; document upgrade procedure |
| KV namespace IDs leaked into git | Medium | Low | IDs are public-safe; secrets handled separately |
| `nodejs_compat` enables unintended polyfills | Low | Med | Lint imports; only allow `node:crypto` if needed |

## Security Considerations

- Secrets via `wrangler secret put` only — never commit `.dev.vars`.
- `.gitignore` blocks `.dev.vars`, `.wrangler/`, `node_modules/`.

## Next Steps

- Phase 2 consumes `Env` and `ApiResponse` from `src/types.ts`.

## Rollback

Delete generated files; remove KV namespace via `wrangler kv namespace delete`. No external state created.
