import type { Env } from "../types";
import { sleep, RATE_LIMIT_DELAY_MS } from "../middleware/rate-limiter";

export class BitrixApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = "BitrixApiError";
  }
}

export interface PagedResult<T> {
  items: T;
  total: number;
}

type BitrixBody<T> = {
  result?: T;
  total?: number;
  error?: string;
  error_description?: string;
};

const MAX_RETRIES = 3;

/** Shared fetch+retry logic. Returns parsed body on success, throws on exhaustion. */
async function fetchBitrix<T>(
  url: string,
  params: Record<string, unknown>
): Promise<BitrixBody<T>> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await sleep(RATE_LIMIT_DELAY_MS);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    // On final attempt, parse and return regardless so callers see the real error code
    if (res.status === 503 || res.status >= 500) {
      if (attempt < MAX_RETRIES - 1) {
        await sleep(Math.pow(2, attempt) * 1000);
        continue;
      }
    }

    const body = (await res.json()) as BitrixBody<T>;
    if (body.error) {
      throw new BitrixApiError(
        body.error,
        body.error_description ?? body.error,
        res.status
      );
    }

    if (res.status === 503 || res.status >= 500) {
      // Exhausted retries with a server error but no Bitrix error body
      throw new BitrixApiError("rate_limit_exhausted", "max retries reached", res.status);
    }

    return body;
  }

  throw new BitrixApiError("rate_limit_exhausted", "max retries reached", 503);
}

export async function callApi<T = unknown>(
  env: Env,
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const url = `${env.BITRIX_WEBHOOK_URL.replace(/\/$/, "")}/${method}.json`;
  const body = await fetchBitrix<T>(url, params);
  return body.result as T;
}

/** Like callApi but also returns the `total` count from paged list responses. */
export async function callApiPaged<T = unknown>(
  env: Env,
  method: string,
  params: Record<string, unknown> = {}
): Promise<PagedResult<T>> {
  const url = `${env.BITRIX_WEBHOOK_URL.replace(/\/$/, "")}/${method}.json`;
  const body = await fetchBitrix<T>(url, params);
  return { items: body.result as T, total: body.total ?? 0 };
}
