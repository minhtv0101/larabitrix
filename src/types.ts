export interface Env {
  SCHEMA_KV: KVNamespace;
  BITRIX_WEBHOOK_URL: string;
  WORKER_API_KEY: string;
}

export interface BitrixSchema {
  iblockId: string;
  toBitrix: Record<string, string>;
  toClean: Record<string, string>;
  fetchedAt: number;
}

export interface BitrixElement {
  ID: string;
  NAME?: string;
  PROPERTY_VALUES?: Record<string, unknown>;
  [k: string]: unknown;
}

export type CrmEntity = "contact" | "company" | "deal";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}
