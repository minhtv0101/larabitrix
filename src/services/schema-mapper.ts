import type { Env, BitrixSchema, BitrixElement } from "../types";
import { callApi, BitrixApiError } from "./bitrix24-client";

const schemaCache = new Map<string, BitrixSchema>();
const RAM_TTL_MS = 3_600_000; // 1 hour — prevents stale schema surviving long isolate lifetime

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export async function buildListSchema(
  env: Env,
  iblockId: string
): Promise<BitrixSchema> {
  // Layer 1: RAM (bounded by TTL to prevent stale schema across long isolate lifetime)
  const cached = schemaCache.get(iblockId);
  if (cached && Date.now() - cached.fetchedAt < RAM_TTL_MS) return cached;

  // Layer 2: KV (optional — skipped if namespace not provisioned)
  if (env.SCHEMA_KV) {
    const kvSchema = await env.SCHEMA_KV.get<BitrixSchema>(
      `schema:${iblockId}`,
      { type: "json", cacheTtl: 300 }
    );
    if (kvSchema) {
      schemaCache.set(iblockId, kvSchema);
      return kvSchema;
    }
  }

  // Layer 3: Bitrix24 API
  const fields = await callApi<Record<string, { NAME: string; CODE?: string }>>(
    env,
    "lists.field.get",
    { IBLOCK_TYPE_ID: "lists", IBLOCK_ID: iblockId }
  );

  const toBitrix: Record<string, string> = {};
  const toClean: Record<string, string> = {};

  for (const [propertyKey, fieldDef] of Object.entries(fields)) {
    const cleanKey = fieldDef.CODE
      ? fieldDef.CODE.toLowerCase()
      : slugify(fieldDef.NAME);

    // Detect collisions — throw rather than silently overwrite
    if (toBitrix[cleanKey]) {
      throw new BitrixApiError(
        "schema_collision",
        `Schema collision: clean key "${cleanKey}" maps to both ${toBitrix[cleanKey]} and ${propertyKey}`
      );
    }

    toBitrix[cleanKey] = propertyKey;
    toClean[propertyKey] = cleanKey;
  }

  const schema: BitrixSchema = {
    iblockId,
    toBitrix,
    toClean,
    fetchedAt: Date.now(),
  };

  if (env.SCHEMA_KV) {
    await env.SCHEMA_KV.put(`schema:${iblockId}`, JSON.stringify(schema), {
      expirationTtl: 86400,
    });
  }
  schemaCache.set(iblockId, schema);

  return schema;
}

/** Maps a clean payload to Bitrix PROPERTY_VALUES write shape. */
export function transformToBitrix(
  clean: Record<string, unknown>,
  schema: BitrixSchema
): { PROPERTY_VALUES: Record<string, unknown> } {
  const PROPERTY_VALUES: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(clean)) {
    const propKey = schema.toBitrix[k];
    if (propKey) PROPERTY_VALUES[propKey] = v;
  }
  return { PROPERTY_VALUES };
}

/** Unwraps a Bitrix element into a flat clean object.
 *
 * lists.element.get returns properties as top-level keys (PROPERTY_123, PROPERTY_456)
 * directly on the element — NOT nested inside PROPERTY_VALUES. We iterate over all
 * known schema keys at the top level, and also fall back to PROPERTY_VALUES for
 * write-operation response shapes.
 */
export function transformToClean(
  item: BitrixElement,
  schema: BitrixSchema
): Record<string, unknown> {
  const out: Record<string, unknown> = { id: item.ID };
  if (item.NAME !== undefined) out["name"] = item.NAME;

  // Primary: properties come back as top-level PROPERTY_XXX keys (lists.element.get)
  for (const [propKey, cleanKey] of Object.entries(schema.toClean)) {
    if (propKey in item) {
      out[cleanKey] = unwrapPropertyValue(item[propKey]);
    }
  }

  // Fallback: PROPERTY_VALUES shape (used in some write-op responses)
  for (const [propKey, raw] of Object.entries(item.PROPERTY_VALUES ?? {})) {
    const cleanKey = schema.toClean[propKey];
    if (!cleanKey || cleanKey in out) continue;
    out[cleanKey] = unwrapPropertyValue(raw);
  }

  return out;
}

/** Handles both `{ n0: { value: "X" } }` and plain-value shapes. */
function unwrapPropertyValue(raw: unknown): unknown {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const firstKey = Object.keys(obj)[0];
    if (firstKey) {
      const nested = obj[firstKey];
      if (nested !== null && typeof nested === "object") {
        const n = nested as Record<string, unknown>;
        return n["value"] ?? n["VALUE"] ?? nested;
      }
      return obj[firstKey];
    }
  }
  return raw;
}

export async function invalidateSchema(
  env: Env,
  iblockId: string
): Promise<void> {
  schemaCache.delete(iblockId);
  if (env.SCHEMA_KV) {
    await env.SCHEMA_KV.delete(`schema:${iblockId}`);
  }
}
