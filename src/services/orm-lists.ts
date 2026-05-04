import type { Env, BitrixElement } from "../types";
import { callApi, callApiPaged, BitrixApiError } from "./bitrix24-client";
import {
  buildListSchema,
  transformToBitrix,
  transformToClean,
} from "./schema-mapper";

const IBLOCK_TYPE = "lists";
const PAGE_SIZE = 50;

export interface PaginateResult {
  items: Record<string, unknown>[];
  page: number;
  total: number;
  totalPages: number;
}

export interface UpsertResult {
  id: string;
  action: "created" | "updated";
  item: Record<string, unknown>;
}

export interface MathResult {
  id: string;
  field: string;
  previous: number;
  current: number;
}

export interface DeleteResult {
  id: string;
  deleted: true;
}

export async function paginate(
  env: Env,
  iblockId: string,
  filter: Record<string, unknown>,
  page = 1
): Promise<PaginateResult> {
  const schema = await buildListSchema(env, iblockId);

  // Translate clean filter keys to Bitrix PROPERTY keys; silently drop unknown keys
  // (never fall through to raw caller-supplied Bitrix field names — filter injection risk)
  const bitrixFilter: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filter)) {
    const propKey = schema.toBitrix[k];
    if (propKey) bitrixFilter[propKey] = v;
  }

  const { items: raw, total } = await callApiPaged<BitrixElement[]>(
    env,
    "lists.element.get",
    {
      IBLOCK_TYPE_ID: IBLOCK_TYPE,
      IBLOCK_ID: iblockId,
      FILTER: bitrixFilter,
      start: (page - 1) * PAGE_SIZE,
    }
  );

  const items = (raw ?? []).map((el) => transformToClean(el, schema));
  return {
    items,
    page,
    total,
    totalPages: Math.ceil(total / PAGE_SIZE),
  };
}

export async function create(
  env: Env,
  iblockId: string,
  payload: Record<string, unknown>
): Promise<UpsertResult> {
  const schema = await buildListSchema(env, iblockId);
  const elementCode = `ts-${Date.now()}-${crypto.randomUUID()}`;
  const { PROPERTY_VALUES } = transformToBitrix(payload, schema);
  const id = await callApi<string>(env, "lists.element.add", {
    IBLOCK_TYPE_ID: IBLOCK_TYPE,
    IBLOCK_ID: iblockId,
    ELEMENT_CODE: elementCode,
    FIELDS: {
      NAME: (payload["name"] as string | undefined) ?? elementCode,
      PROPERTY_VALUES,
    },
  });
  return { id: String(id), action: "created", item: payload };
}

export async function updateOrCreate(
  env: Env,
  iblockId: string,
  uniqueField: string,
  payload: Record<string, unknown>
): Promise<UpsertResult> {
  const schema = await buildListSchema(env, iblockId);
  const propKey = schema.toBitrix[uniqueField];
  if (!propKey) {
    throw new BitrixApiError("unknown_field", `Unknown field: ${uniqueField}`);
  }

  const existingList = await callApi<BitrixElement[]>(
    env,
    "lists.element.get",
    {
      IBLOCK_TYPE_ID: IBLOCK_TYPE,
      IBLOCK_ID: iblockId,
      FILTER: { [propKey]: payload[uniqueField] },
    }
  );

  const existing = (existingList ?? [])[0];

  if (existing) {
    const existingClean = transformToClean(existing, schema);
    const merged = { ...existingClean, ...payload } as Record<string, unknown>;
    const { PROPERTY_VALUES } = transformToBitrix(merged, schema);
    await callApi(env, "lists.element.update", {
      IBLOCK_TYPE_ID: IBLOCK_TYPE,
      IBLOCK_ID: iblockId,
      ELEMENT_ID: existing.ID,
      FIELDS: {
        NAME:
          (merged["name"] as string | undefined) ??
          existing.NAME ??
          existing.ID,
        PROPERTY_VALUES,
      },
    });
    return { id: existing.ID, action: "updated", item: merged };
  }

  const elementCode = `ts-${Date.now()}-${crypto.randomUUID()}`;
  const { PROPERTY_VALUES } = transformToBitrix(payload, schema);
  const newId = await callApi<string>(env, "lists.element.add", {
    IBLOCK_TYPE_ID: IBLOCK_TYPE,
    IBLOCK_ID: iblockId,
    ELEMENT_CODE: elementCode,
    FIELDS: {
      NAME:
        (payload["name"] as string | undefined) ??
        String(payload[uniqueField]) ??
        elementCode,
      PROPERTY_VALUES,
    },
  });
  return { id: String(newId), action: "created", item: payload };
}

export async function math(
  env: Env,
  iblockId: string,
  itemId: string,
  fieldName: string,
  amount: number
): Promise<MathResult> {
  const schema = await buildListSchema(env, iblockId);

  const existingList = await callApi<BitrixElement[]>(
    env,
    "lists.element.get",
    {
      IBLOCK_TYPE_ID: IBLOCK_TYPE,
      IBLOCK_ID: iblockId,
      FILTER: { ID: itemId },
    }
  );

  const existing = (existingList ?? [])[0];
  if (!existing) {
    throw new BitrixApiError("not_found", `Item ${itemId} not found`);
  }

  const existingClean = transformToClean(existing, schema);
  const previous = Number(existingClean[fieldName] ?? 0);
  if (Number.isNaN(previous)) {
    throw new BitrixApiError(
      "invalid_value",
      `Field "${fieldName}" has non-numeric value`
    );
  }
  // KNOWN RACE: read-modify-write is not atomic. Concurrent math calls on the same
  // item can lose increments. Fixing this requires a Durable Object mutex.
  const current = previous + amount;

  const merged = { ...existingClean, [fieldName]: current } as Record<
    string,
    unknown
  >;
  const { PROPERTY_VALUES } = transformToBitrix(merged, schema);
  await callApi(env, "lists.element.update", {
    IBLOCK_TYPE_ID: IBLOCK_TYPE,
    IBLOCK_ID: iblockId,
    ELEMENT_ID: itemId,
    FIELDS: {
      NAME: existing.NAME ?? itemId,
      PROPERTY_VALUES,
    },
  });

  return { id: itemId, field: fieldName, previous, current };
}

export async function hardDelete(
  env: Env,
  iblockId: string,
  itemId: string
): Promise<DeleteResult> {
  await callApi(env, "lists.element.delete", {
    IBLOCK_TYPE_ID: IBLOCK_TYPE,
    IBLOCK_ID: iblockId,
    ELEMENT_ID: itemId,
  });
  return { id: itemId, deleted: true };
}
