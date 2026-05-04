import type { Env } from "../types";
import { callApi } from "./bitrix24-client";

export interface CrmUpsertResult {
  id: string | number;
  action: "created" | "updated";
}

export interface DealResult {
  id: string | number;
  item: Record<string, unknown>;
}

type PhoneField = Array<{ VALUE: string; VALUE_TYPE: string }>;

/** Wraps a phone string in the Bitrix24 multifield write shape. */
function normalizePhone(value: string): PhoneField {
  return [{ VALUE: value, VALUE_TYPE: "WORK" }];
}

interface CrmItemListResult {
  items?: Array<{ id: string | number; [k: string]: unknown }>;
}

interface CrmItemAddResult {
  item: { id: string | number; [k: string]: unknown };
}

export async function upsertCrmEntity(
  env: Env,
  entityTypeId: number,
  uniqueField: string,
  uniqueValue: string,
  payload: Record<string, unknown>
): Promise<CrmUpsertResult> {
  const found = await callApi<CrmItemListResult>(env, "crm.item.list", {
    entityTypeId,
    filter: { [uniqueField]: uniqueValue },
    select: ["*"],
  });

  const existing = found?.items?.[0];

  // Build the normalized payload for write
  const writePayload = { ...payload };
  if (uniqueField === "PHONE") {
    writePayload["PHONE"] = normalizePhone(
      (payload["PHONE"] as string | undefined) ?? uniqueValue
    );
  }

  if (existing) {
    await callApi(env, "crm.item.update", {
      entityTypeId,
      id: existing.id,
      fields: writePayload,
    });
    return { action: "updated", id: existing.id };
  }

  const merged: Record<string, unknown> = {
    [uniqueField]:
      uniqueField === "PHONE" ? normalizePhone(uniqueValue) : uniqueValue,
    ...writePayload,
  };

  const created = await callApi<CrmItemAddResult>(env, "crm.item.add", {
    entityTypeId,
    fields: merged,
  });
  return { action: "created", id: created.item.id };
}

export async function createDeal(
  env: Env,
  fields: Record<string, unknown>
): Promise<DealResult> {
  const result = await callApi<CrmItemAddResult>(env, "crm.item.add", {
    entityTypeId: 2,
    fields,
  });
  return { id: result.item.id, item: result.item };
}
