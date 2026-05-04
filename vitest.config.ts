import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Inject test secrets that would normally come from `wrangler secret put`
          bindings: {
            BITRIX_WEBHOOK_URL: "https://example.test/rest/",
            WORKER_API_KEY: "test-api-key",
          },
        },
      },
    },
    coverage: {
      provider: "istanbul",
      include: ["src/**"],
      thresholds: {
        lines: 80,
        functions: 80,
      },
    },
  },
});
