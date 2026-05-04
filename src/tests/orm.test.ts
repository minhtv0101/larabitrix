import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Env } from "../types";
import { paginate, updateOrCreate, math, hardDelete } from "../services/orm-lists";
import { upsertCrmEntity, createDeal } from "../services/orm-crm";
import { invalidateSchema } from "../services/schema-mapper";
import {
  mockFetch,
  bitrixOk,
  fixtureElement,
  fixtureFieldsResponse,
  makeTestEnv,
} from "./_helpers";

vi.mock("../middleware/rate-limiter", () => ({
  sleep: () => Promise.resolve(),
  RATE_LIMIT_DELAY_MS: 0,
}));

const IBLOCK = "42";

let e: Env;
let restoreFetch: () => void;

beforeEach(async () => {
  e = makeTestEnv();
  await invalidateSchema(e, IBLOCK);
});

afterEach(() => {
  restoreFetch?.();
});

/** Helper: mock sequential Bitrix responses (schema + data calls). */
function mockSequence(...responses: Response[]): void {
  let i = 0;
  restoreFetch = mockFetch(() => {
    const r = responses[i];
    if (i < responses.length - 1) i++;
    return r ?? bitrixOk(null);
  });
}

describe("paginate", () => {
  it("returns mapped items, page, and totalPages", async () => {
    const items = [fixtureElement("1", "+84", "hi", 0)];
    mockSequence(
      bitrixOk(fixtureFieldsResponse()), // schema fetch
      bitrixOk(items)                     // lists.element.get (with total missing → 0)
    );
    const result = await paginate(e, IBLOCK, {}, 1);
    expect(result.page).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: "1", phone: "+84" });
  });
});

describe("updateOrCreate", () => {
  it("creates item when no existing record found", async () => {
    mockSequence(
      bitrixOk(fixtureFieldsResponse()),  // schema
      bitrixOk([]),                         // get → empty → create path
      bitrixOk("99")                        // lists.element.add → new id
    );
    const result = await updateOrCreate(e, IBLOCK, "phone", { phone: "+84999" });
    expect(result.action).toBe("created");
    expect(result.id).toBe("99");
  });

  it("updates item and preserves existing fields (read-before-write)", async () => {
    // Existing item has phone + note; we only send phone
    const existing = fixtureElement("5", "+84old", "keep this note", 0);
    mockSequence(
      bitrixOk(fixtureFieldsResponse()),   // schema
      bitrixOk([existing]),                 // get → existing found
      bitrixOk(true)                        // lists.element.update
    );

    let capturedFields: Record<string, unknown> = {};
    restoreFetch = mockFetch((url, init) => {
      const body = JSON.parse((init.body as string) ?? "{}") as Record<string, unknown>;
      if (typeof url === "string" && url.includes("lists.element.update")) {
        capturedFields = (body["FIELDS"] as Record<string, unknown>) ?? {};
      }
      if (url.includes("lists.field.get")) return bitrixOk(fixtureFieldsResponse());
      if (url.includes("lists.element.get")) return bitrixOk([existing]);
      return bitrixOk(true);
    });

    await updateOrCreate(e, IBLOCK, "phone", { phone: "+84new" });

    // note must still be in the update payload
    const props = capturedFields["PROPERTY_VALUES"] as Record<string, unknown> | undefined;
    expect(props?.["PROPERTY_124"]).toBe("keep this note");
  });

  it("throws unknown_field for unmapped field name", async () => {
    mockSequence(bitrixOk(fixtureFieldsResponse()));
    await expect(
      updateOrCreate(e, IBLOCK, "no_such_field", { no_such_field: "x" })
    ).rejects.toMatchObject({ code: "unknown_field" });
  });
});

describe("math", () => {
  it("increments field and preserves other fields", async () => {
    const existing = fixtureElement("7", "+84", "note", 5);

    let updatePayload: Record<string, unknown> = {};
    restoreFetch = mockFetch((url, init) => {
      const body = JSON.parse((init.body as string) ?? "{}") as Record<string, unknown>;
      if (url.includes("lists.field.get")) return bitrixOk(fixtureFieldsResponse());
      if (url.includes("lists.element.get")) return bitrixOk([existing]);
      if (url.includes("lists.element.update")) {
        updatePayload = (body["FIELDS"] as Record<string, unknown>) ?? {};
        return bitrixOk(true);
      }
      return bitrixOk(null);
    });

    const result = await math(e, IBLOCK, "7", "counter", 3);
    expect(result.previous).toBe(5);
    expect(result.current).toBe(8);

    // phone field must still be present (read-before-write)
    const props = updatePayload["PROPERTY_VALUES"] as Record<string, unknown> | undefined;
    expect(props?.["PROPERTY_123"]).toBe("+84");
  });

  it("returns current=2 after math(+5) then math(-3)", async () => {
    let currentVal = 0;
    restoreFetch = mockFetch((url, init) => {
      const body = JSON.parse((init.body as string) ?? "{}") as Record<string, unknown>;
      if (url.includes("lists.field.get")) return bitrixOk(fixtureFieldsResponse());
      if (url.includes("lists.element.get")) {
        return bitrixOk([fixtureElement("10", "+84", "n", currentVal)]);
      }
      if (url.includes("lists.element.update")) {
        const props = (body["FIELDS"] as Record<string, unknown>)?.["PROPERTY_VALUES"] as Record<string, unknown>;
        currentVal = Number(props?.["PROPERTY_125"]);
        return bitrixOk(true);
      }
      return bitrixOk(null);
    });

    await math(e, IBLOCK, "10", "counter", 5);
    const res = await math(e, IBLOCK, "10", "counter", -3);
    expect(res.current).toBe(2);
  });

  it("throws on non-numeric field value", async () => {
    const bad = fixtureElement("9", "+84", "n", "abc");
    // Override counter value to non-numeric
    (bad.PROPERTY_VALUES.PROPERTY_125 as Record<string, unknown>) = { n0: { value: "abc" } };
    restoreFetch = mockFetch((url) => {
      if (url.includes("lists.field.get")) return bitrixOk(fixtureFieldsResponse());
      return bitrixOk([bad]);
    });
    await expect(math(e, IBLOCK, "9", "counter", 1)).rejects.toMatchObject({
      code: "invalid_value",
    });
  });
});

describe("hardDelete", () => {
  it("calls lists.element.delete and returns deleted: true", async () => {
    let deleteCalled = false;
    restoreFetch = mockFetch((url) => {
      if (url.includes("lists.element.delete")) { deleteCalled = true; return bitrixOk(true); }
      return bitrixOk(null);
    });
    const result = await hardDelete(e, IBLOCK, "55");
    expect(deleteCalled).toBe(true);
    expect(result).toEqual({ id: "55", deleted: true });
  });
});

describe("upsertCrmEntity", () => {
  it("creates contact when PHONE not found", async () => {
    restoreFetch = mockFetch((url, init) => {
      const body = JSON.parse((init.body as string) ?? "{}") as Record<string, unknown>;
      if (url.includes("crm.item.list")) return bitrixOk({ items: [] });
      if (url.includes("crm.item.add")) {
        // Phone must be normalized to multifield array
        const fields = body["fields"] as Record<string, unknown>;
        const phone = fields["PHONE"] as Array<{ VALUE: string; VALUE_TYPE: string }> | undefined;
        expect(Array.isArray(phone)).toBe(true);
        expect(phone?.[0]?.VALUE_TYPE).toBe("WORK");
        return bitrixOk({ item: { id: 42 } });
      }
      return bitrixOk(null);
    });
    const result = await upsertCrmEntity(e, 3, "PHONE", "+84123", { NAME: "Test" });
    expect(result.action).toBe("created");
    expect(result.id).toBe(42);
  });

  it("updates company when UF_CRM_MST already exists", async () => {
    restoreFetch = mockFetch((url) => {
      if (url.includes("crm.item.list")) return bitrixOk({ items: [{ id: 77 }] });
      if (url.includes("crm.item.update")) return bitrixOk({ item: { id: 77 } });
      return bitrixOk(null);
    });
    const result = await upsertCrmEntity(e, 4, "UF_CRM_MST", "123456789", {});
    expect(result.action).toBe("updated");
    expect(result.id).toBe(77);
  });
});

describe("createDeal", () => {
  it("passes entityTypeId=2 and forwards CONTACT_ID/COMPANY_ID", async () => {
    let captured: Record<string, unknown> = {};
    restoreFetch = mockFetch((url, init) => {
      captured = JSON.parse((init.body as string) ?? "{}") as Record<string, unknown>;
      return bitrixOk({ item: { id: 11 } });
    });
    const result = await createDeal(e, {
      TITLE: "Deal",
      CONTACT_ID: 5,
      COMPANY_ID: 3,
    });
    expect(captured["entityTypeId"]).toBe(2);
    const fields = captured["fields"] as Record<string, unknown>;
    expect(fields["CONTACT_ID"]).toBe(5);
    expect(fields["COMPANY_ID"]).toBe(3);
    expect(result.id).toBe(11);
  });
});
