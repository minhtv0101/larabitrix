import type { BitrixSchema, Env } from "../types";

export const TEST_WEBHOOK_URL = "https://example.test/rest/";
export const TEST_API_KEY = "test-api-key";

type FetchHandler = (
  url: string,
  init: RequestInit
) => Response | Promise<Response>;

/** Monkey-patches globalThis.fetch; returns a restore fn. */
export function mockFetch(handler: FetchHandler): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    return Promise.resolve(handler(url, init ?? {}));
  };
  return () => {
    globalThis.fetch = original;
  };
}

/** Builds a 200 Bitrix success response wrapping result. */
export function bitrixOk(result: unknown): Response {
  return new Response(JSON.stringify({ result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Builds a Bitrix 503 rate-limit response. */
export function bitrix503(): Response {
  return new Response(
    JSON.stringify({
      error: "QUERY_LIMIT_EXCEEDED",
      error_description: "rate limit exceeded",
    }),
    { status: 503 }
  );
}

/** In-memory KVNamespace for tests (no cloudflare:test dependency). */
function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  // Cast to bypass the complex overload signatures — behaviour is correct for our use cases
  return {
    get: async (key: string, opts?: unknown): Promise<unknown> => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      const type =
        typeof opts === "string"
          ? opts
          : (opts as { type?: string } | undefined)?.type;
      if (type === "json") return JSON.parse(raw) as unknown;
      return raw;
    },
    put: async (key: string, value: unknown): Promise<void> => {
      store.set(key, typeof value === "string" ? value : String(value));
    },
    delete: async (key: string): Promise<void> => {
      store.delete(key);
    },
    list: async (): Promise<unknown> => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async (): Promise<unknown> => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

/** Returns a fresh Env for unit tests (no real KV/Bitrix). */
export function makeTestEnv(): Env {
  return {
    SCHEMA_KV: createMockKV(),
    BITRIX_WEBHOOK_URL: TEST_WEBHOOK_URL,
    WORKER_API_KEY: TEST_API_KEY,
  };
}

/** Pre-built schema fixture: phone, note, counter. */
export function fixtureSchema(): BitrixSchema {
  return {
    iblockId: "42",
    toBitrix: {
      phone: "PROPERTY_123",
      note: "PROPERTY_124",
      counter: "PROPERTY_125",
    },
    toClean: {
      PROPERTY_123: "phone",
      PROPERTY_124: "note",
      PROPERTY_125: "counter",
    },
    fetchedAt: Date.now(),
  };
}

/** Raw Bitrix lists.field.get response fixture. */
export function fixtureFieldsResponse(): Record<
  string,
  { NAME: string; CODE?: string; TYPE: string }
> {
  return {
    PROPERTY_123: { NAME: "Phone Number", CODE: "phone", TYPE: "string" },
    PROPERTY_124: { NAME: "Note", CODE: "note", TYPE: "string" },
    PROPERTY_125: { NAME: "Counter", CODE: "counter", TYPE: "number" },
  };
}

/** Returns a Bitrix element fixture with nested PROPERTY_VALUES. */
export function fixtureElement(
  id: string,
  phone: string,
  note: string,
  counter: string | number
) {
  return {
    ID: id,
    NAME: "Test Element",
    PROPERTY_VALUES: {
      PROPERTY_123: { n0: { value: phone, VALUE: phone } },
      PROPERTY_124: { n0: { value: note, VALUE: note } },
      PROPERTY_125: { n0: { value: String(counter), VALUE: String(counter) } },
    },
  };
}
